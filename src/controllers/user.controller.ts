import { Response } from 'express'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../config/db'
import {
    ROLE_DEFAULT_ACTIONS,
    ALL_ACTIONS,
    actionsToKebab,
    kebabToAction,
    ActionEnum,
    invalidateUserActionsCache,
} from '../utils/actions'

// ─── GET /users — list all staff users ───────────────────────────────────────

export async function listStaffUsers(_req: AuthRequest, res: Response): Promise<void> {
    const users = await prisma.user.findMany({
        where: { type: 'STAFF' },
        include: { staffProfile: true, grantedActions: true },
        orderBy: { createdAt: 'desc' },
    })

    res.json({
        success: true,
        data: users.map((u) => {
            const roleDefaults = ROLE_DEFAULT_ACTIONS[u.staffProfile?.staffRole ?? ''] ?? []
            const extraEnums = u.grantedActions.map((a) => a.action)
            const effective = [...new Set([...roleDefaults, ...extraEnums])]

            return {
                id: u.id,
                email: u.email,
                fullName: u.staffProfile?.fullName ?? null,
                nuId: u.staffProfile?.nuId ?? null,
                staffRole: u.staffProfile?.staffRole ?? null,
                isApproved: u.staffProfile?.isApproved ?? null,
                roleActions: actionsToKebab(roleDefaults),
                extraActions: actionsToKebab(extraEnums),
                effectiveActions: actionsToKebab(effective),
            }
        }),
    })
}

// ─── GET /users/:id/actions — get a user's actions breakdown ─────────────────

export async function getUserActions(req: AuthRequest, res: Response): Promise<void> {
    const id = String(req.params.id)

    const user = await prisma.user.findUnique({
        where: { id },
        include: { staffProfile: true, grantedActions: true },
    })

    if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' })
        return
    }

    const roleDefaults = ROLE_DEFAULT_ACTIONS[user.staffProfile?.staffRole ?? ''] ?? []
    const extraEnums = user.grantedActions.map((a) => a.action)
    const effective = [...new Set([...roleDefaults, ...extraEnums])]

    res.json({
        success: true,
        data: {
            roleActions: actionsToKebab(roleDefaults),
            extraActions: actionsToKebab(extraEnums),
            effectiveActions: actionsToKebab(effective),
        },
    })
}

// ─── PUT /users/:id/actions — set a user's extra actions ─────────────────────

export async function updateUserActions(req: AuthRequest, res: Response): Promise<void> {
    const id = String(req.params.id)
    const { actions } = req.body as { actions: string[] } // kebab-case IDs

    // Validate target user exists
    const user = await prisma.user.findUnique({
        where: { id },
        include: { staffProfile: true },
    })

    if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' })
        return
    }

    // Convert kebab → SCREAMING_SNAKE and validate
    const actionEnums = actions.map(kebabToAction)
    const allValid = ALL_ACTIONS as readonly string[]
    const invalid = actionEnums.filter((a) => !allValid.includes(a))

    if (invalid.length > 0) {
        res.status(400).json({
            success: false,
            message: `Invalid actions: ${invalid.join(', ')}`,
        })
        return
    }

    // Strip out role-default actions (no need to store them as extras)
    const roleDefaults = ROLE_DEFAULT_ACTIONS[user.staffProfile?.staffRole ?? ''] ?? []
    const extraOnly = actionEnums.filter((a) => !roleDefaults.includes(a as ActionEnum))

    // Transaction: wipe existing extras, then insert new ones
    await prisma.$transaction([
        prisma.userAction.deleteMany({ where: { userId: id } }),
        ...extraOnly.map((action) =>
            prisma.userAction.create({
                data: {
                    userId: id,
                    action: action as ActionEnum,
                    grantedBy: req.userId,
                },
            })
        ),
    ])

    // Bust the permission cache so the user picks up new actions immediately
    invalidateUserActionsCache(id)

    const effective = [...new Set([...roleDefaults, ...extraOnly])]

    res.json({
        success: true,
        message: 'User actions updated successfully.',
        data: {
            extraActions: actionsToKebab(extraOnly),
            effectiveActions: actionsToKebab(effective),
        },
    })
}
