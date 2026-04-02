import { Request, Response } from 'express'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../config/db'
import { supabaseAdmin, supabasePublic } from '../config/supabase'
import { deriveNuId } from '../utils/nuId'
import { StaffRole, UserType } from '@prisma/client'
import { ROLE_DEFAULT_ACTIONS, actionsToKebab } from '../utils/actions'

export async function refreshToken(req: Request, res: Response): Promise<void> {
    const { refreshToken: token } = req.body as { refreshToken?: string }

    if (!token) {
        res.status(400).json({ success: false, message: 'Refresh token is required.' })
        return
    }

    // supabasePublic.auth.setSession exchanges the refresh token for a new session
    const { data, error } = await supabasePublic.auth.setSession({
        access_token:  '',   // Supabase ignores this when refresh_token is valid
        refresh_token: token,
    })

    if (error || !data.session) {
        res.status(401).json({ success: false, message: 'Refresh token is invalid or expired. Please log in again.' })
        return
    }

    res.status(200).json({
        success:      true,
        message:      'Token refreshed.',
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn:    data.session.expires_in,
    })
}

// for logout
export async function logoutUser(req: Request, res: Response): Promise<void> {
    const authHeader = req.headers.authorization ?? ''
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!jwt) {
        res.status(400).json({ success: false, message: 'No access token provided.' })
        return
    }

    const { error } = await supabaseAdmin.auth.admin.signOut(jwt, 'global')

    if (error) {
        console.error('[logout] Supabase signOut error:', error.message)
    }

    res.status(200).json({ success: true, message: 'Logged out successfully.' })
}

// for login
export async function loginUser(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as { email: string; password: string }

    const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password })

    if (error || !data.session || !data.user) {
        const isInvalid =
            error?.message?.toLowerCase().includes('invalid') ||
            error?.message?.toLowerCase().includes('credentials')

        res.status(isInvalid ? 401 : 500).json({
            success: false,
            message: isInvalid
                ? 'Invalid email or password.'
                : (error?.message ?? 'Login failed. Please try again.'),
        })
        return
    }

    const { session, user: supabaseUser } = data

    // fetch matching prisma User + StaffProfile + extra granted actions
    const prismaUser = await prisma.user.findUnique({
        where: { id: supabaseUser.id },
        include: { staffProfile: true, grantedActions: true },
    })

    if (!prismaUser) {
        res.status(404).json({ success: false, message: 'No account found for this user.' })
        return
    }

    if (!prismaUser.isActive) {
        res.status(403).json({ success: false, message: 'Your account has been deactivated.' })
        return
    }

    // if (prismaUser.staffProfile && !prismaUser.staffProfile.isApproved) {
    //     res.status(403).json({
    //         success: false,
    //         message: 'Your account is pending admin approval.',
    //     })
    //     return
    // }

    // update lastLogin timestamp (fire-and-forget — non-critical, saves ~50 ms)
    prisma.user.update({
        where: { id: prismaUser.id },
        data: { lastLogin: new Date() },
    }).catch((err: unknown) => console.error('[login] lastLogin update failed:', err))

    // Compute effective actions: role defaults ∪ extra grants
    const roleDefaults = ROLE_DEFAULT_ACTIONS[prismaUser.staffProfile?.staffRole ?? ''] ?? []
    const extraEnums   = prismaUser.grantedActions.map((a) => a.action)
    const effective    = [...new Set([...roleDefaults, ...extraEnums])]

    // return session tokens + profile + actions
    res.status(200).json({
        success: true,
        message: 'Login successful.',
        data: {
            accessToken:  session.access_token,
            refreshToken: session.refresh_token,
            expiresIn:    session.expires_in,
            user: {
                id:         prismaUser.id,
                email:      prismaUser.email,
                type:       prismaUser.type,
                nuId:       prismaUser.staffProfile?.nuId       ?? null,
                fullName:   prismaUser.staffProfile?.fullName   ?? null,
                staffRole:  prismaUser.staffProfile?.staffRole  ?? null,
                isApproved: prismaUser.staffProfile?.isApproved ?? null,
                actions:    actionsToKebab(effective),
            },
        },
    })
}

// GET /auth/me — return the current user's profile with freshly-computed actions

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
    const userId = req.userId
    if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized.' })
        return
    }

    const prismaUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { staffProfile: true, grantedActions: true },
    })

    if (!prismaUser || !prismaUser.isActive) {
        res.status(404).json({ success: false, message: 'User not found.' })
        return
    }

    const roleDefaults = ROLE_DEFAULT_ACTIONS[prismaUser.staffProfile?.staffRole ?? ''] ?? []
    const extraEnums   = prismaUser.grantedActions.map((a) => a.action)
    const effective    = [...new Set([...roleDefaults, ...extraEnums])]

    res.json({
        success: true,
        data: {
            id:         prismaUser.id,
            email:      prismaUser.email,
            type:       prismaUser.type,
            nuId:       prismaUser.staffProfile?.nuId       ?? null,
            fullName:   prismaUser.staffProfile?.fullName   ?? null,
            staffRole:  prismaUser.staffProfile?.staffRole  ?? null,
            isApproved: prismaUser.staffProfile?.isApproved ?? null,
            actions:    actionsToKebab(effective),
        },
    })
}

// for register

// Maps frontend role strings to Prisma StaffRole enum values
const ROLE_MAP: Record<string, StaffRole> = {
    excom:                  StaffRole.EXCOM,
    pr:                     StaffRole.PR,
    gr:                     StaffRole.GR,
    food:                   StaffRole.FOOD,
    cs:                     StaffRole.COMPETITIONS,
    superadmin:             StaffRole.SUPERADMIN,
    'ambassador-management': StaffRole.AMBASSADOR_MANAGEMENT,
}

export async function registerStaff(req: Request, res: Response): Promise<void> {
    const { fullName, email, password, role } = req.body as {
        fullName: string
        email: string
        password: string
        role: string
    }

    // get nuId
    let nuId: string
    try {
        nuId = deriveNuId(email)
    } catch {
        res.status(400).json({ success: false, message: 'Invalid NU email format.' })
        return
    }

    // get role
    const staffRole = ROLE_MAP[role.toLowerCase()]
    if (!staffRole) {
        res.status(400).json({ success: false, message: `Unknown role: "${role}".` })
        return
    }

    // Check for duplicate nuId (hard conflict — same NU ID can't have two staff profiles)
    const existingNuId = await prisma.staffProfile.findUnique({ where: { nuId } })
    if (existingNuId) {
        res.status(409).json({ success: false, message: 'A staff profile with this NU ID already exists.' })
        return
    }

    const existingUser = await prisma.user.findUnique({
        where: { email },
        include: { staffProfile: true },
    })

    // If user exists AND already has a staff profile, that's a real conflict
    if (existingUser?.staffProfile) {
        res.status(409).json({ success: false, message: 'This user already has a staff profile.' })
        return
    }


    const supabaseCreatePayload = {
        email,
        password,
        email_confirm: true as const,
        app_metadata: { role: staffRole },
        user_metadata: { full_name: fullName, role: staffRole, nu_id: nuId },
    }

    let { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser(supabaseCreatePayload)

    // Ghost-user recovery (Supabase has email but Prisma doesn't, or partial previous attempt)
    if (authError?.message?.toLowerCase().includes('already')) {
        console.warn('[register] Ghost Supabase user detected for', email, '— cleaning up and retrying.')
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
        const ghost = listData?.users?.find((u) => u.email === email)
        if (ghost) {
            await supabaseAdmin.auth.admin.deleteUser(ghost.id)
            ;({ data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser(supabaseCreatePayload))
        }
    }

    if (authError || !authData?.user) {
        console.error('[register] Supabase auth error:', authError)
        res.status(500).json({ success: false, message: authError?.message ?? 'Failed to create auth user.' })
        return
    }

    const supabaseUserId = authData.user.id

    // ── Prisma: reuse existing User or create new one ─────────────────────

    try {
        let user: { id: string; email: string; staffProfile: { nuId: string; fullName: string; staffRole: StaffRole; isApproved: boolean } | null }

        if (existingUser) {
            // User already exists (e.g. was a participant/ambassador) — update id to match Supabase
            // and attach a StaffProfile. Also promote type to STAFF.
            const [updatedUser, staffProfile] = await prisma.$transaction([
                prisma.user.update({
                    where: { id: existingUser.id },
                    data:  { type: UserType.STAFF },
                }),
                prisma.staffProfile.create({
                    data: {
                        id: existingUser.id,
                        fullName,
                        nuId,
                        staffRole,
                        isApproved: false,
                    },
                }),
            ])
            user = { id: updatedUser.id, email: updatedUser.email, staffProfile }
        } else {
            // Brand-new user
            user = await prisma.user.create({
                data: {
                    id:    supabaseUserId,
                    email,
                    type:  UserType.STAFF,
                    staffProfile: {
                        create: { fullName, nuId, staffRole, isApproved: false },
                    },
                },
                include: { staffProfile: true },
            })
        }

        res.status(201).json({
            success: true,
            message: 'Staff account created successfully.',
            data: {
                id:         user.id,
                email:      user.email,
                nuId:       user.staffProfile!.nuId,
                fullName:   user.staffProfile!.fullName,
                staffRole:  user.staffProfile!.staffRole,
                isApproved: user.staffProfile!.isApproved,
            },
        })
    } catch (prismaError) {
        console.error('[register] Prisma error:', prismaError)

        // rollback ; remove the Supabase auth user so they can retry
        await supabaseAdmin.auth.admin.deleteUser(supabaseUserId)

        res.status(500).json({ success: false, message: 'Registration failed while saving profile. Please try again.' })
    }
}
