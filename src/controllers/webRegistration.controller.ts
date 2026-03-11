import { Request, Response } from 'express'
import { prisma } from '../config/db'
import { z } from 'zod'
import { RegistrationStatus } from '@prisma/client'
import { PaymentRequest } from '../middleware/uploadPaymentProof'

const publicMemberSchema = z.object({
    fullName:    z.string().min(1, 'Full name is required'),
    email:       z.string().email('Invalid email'),
    cnic:        z.string().min(13, 'CNIC must be at least 13 characters'),
    phone:       z.string().optional().default(''),
    institution: z.string().optional().default(''),
})

const publicRegistrationSchema = z.object({
    competitionId:    z.string().min(1, 'Competition ID is required'),
    teamName:         z.string().min(1, 'Team name is required'),
    referenceCode:    z.string().optional().default(''),
    isEarlyBird:      z.enum(['true', 'false']).optional().default('false'),
    leaderFullName:   z.string().min(1, 'Leader name is required'),
    leaderEmail:      z.string().email('Leader email is invalid'),
    leaderCnic:       z.string().min(13, 'Leader CNIC must be at least 13 characters'),
    leaderPhone:      z.string().optional().default(''),
    leaderInstitution:z.string().optional().default(''),
    members:          z.string().optional().default(''),
})

function normalizeCnic(value: string): string {
    return value.replace(/\D/g, '')
}

function parseMembers(raw: string | undefined): z.infer<typeof publicMemberSchema>[] {
    if (!raw) return []

    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []

        const validMembers: z.infer<typeof publicMemberSchema>[] = []

        for (const candidate of parsed) {
            const result = publicMemberSchema.safeParse(candidate)
            if (result.success) {
                validMembers.push(result.data)
            }
        }

        return validMembers
    } catch {
        return []
    }
}

function generateReferenceId(): string {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase()
    const year = new Date().getFullYear()
    return `WEB-${year}-${random}`
}

export async function createPublicRegistration(req: PaymentRequest, res: Response): Promise<void> {
    const parsed = publicRegistrationSchema.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({ success: false, errors: parsed.error.issues })
        return
    }

    const paymentProofUrl = req.paymentProofUrl

    if (!paymentProofUrl) {
        res.status(400).json({ success: false, message: 'Payment screenshot upload is missing.' })
        return
    }

    const {
        competitionId,
        teamName,
        referenceCode,
        isEarlyBird: isEarlyBirdRaw,
        leaderFullName,
        leaderEmail,
        leaderCnic,
        leaderPhone,
        leaderInstitution,
        members: membersRaw,
    } = parsed.data

    const isEarlyBird = isEarlyBirdRaw === 'true'

    const extraMembers = parseMembers(membersRaw)

    const allCnics = [
        normalizeCnic(leaderCnic),
        ...extraMembers.map((m) => normalizeCnic(m.cnic)),
    ]

    if (allCnics.length !== new Set(allCnics).size) {
        res.status(400).json({
            success: false,
            message: 'Duplicate CNIC in team members. Each participant must have a unique CNIC.',
        })
        return
    }

    const allEmails = [
        leaderEmail.trim().toLowerCase(),
        ...extraMembers.map((m) => m.email.trim().toLowerCase()),
    ]
    if (allEmails.length !== new Set(allEmails).size) {
        res.status(400).json({
            success: false,
            message: 'Duplicate email in team members. Each participant must have a unique email.',
        })
        return
    }

    const competition = await prisma.competition.findUnique({
        where: { id: competitionId },
        select: { id: true, minTeamSize: true, maxTeamSize: true },
    })

    if (!competition) {
        res.status(404).json({ success: false, message: 'Competition not found.' })
        return
    }

    const totalMembers = 1 + extraMembers.length
    if (totalMembers < competition.minTeamSize || totalMembers > competition.maxTeamSize) {
        res.status(400).json({
            success: false,
            message: `Team must have ${competition.minTeamSize}–${competition.maxTeamSize} members for this competition.`,
        })
        return
    }

    const existingInCompetition = await prisma.teamMember.findMany({
        where: {
            team: { competitionId },
            participant: { cnic: { in: allCnics } },
        },
        select: {
            participant: { select: { fullName: true, cnic: true } },
        },
    })

    if (existingInCompetition.length > 0) {
        const names = existingInCompetition.map((r) => r.participant.fullName).join(', ')
        res.status(409).json({
            success: false,
            message: `One or more team members are already registered for this competition: ${names}`,
        })
        return
    }

    const refToUse = referenceCode?.trim() || ''
    if (refToUse) {
        const existingRef = await prisma.team.findUnique({
            where: { referenceId: refToUse },
        })
        if (existingRef) {
            res.status(409).json({
                success: false,
                message: 'Reference code already in use. Leave it empty for auto-generation.',
            })
            return
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const allMembers = [
                {
                    fullName:    leaderFullName.trim(),
                    email:       leaderEmail.trim().toLowerCase(),
                    cnic:        normalizeCnic(leaderCnic),
                    phone:       (leaderPhone || '').trim(),
                    institution: (leaderInstitution || '').trim(),
                },
                ...extraMembers.map((m) => ({
                    fullName:    m.fullName.trim(),
                    email:       m.email.trim().toLowerCase(),
                    cnic:        normalizeCnic(m.cnic),
                    phone:       (m.phone || '').trim(),
                    institution: (m.institution || '').trim(),
                })),
            ]

            const participantIds: { participantId: string; isLeader: boolean }[] = []

            for (let index = 0; index < allMembers.length; index++) {
                const m = allMembers[index]
                const isLeader = index === 0

                let participant = await tx.participant.findUnique({
                    where: { cnic: m.cnic },
                    include: { user: true },
                })

                if (participant) {
                    participant = await tx.participant.update({
                        where: { id: participant.id },
                        data: {
                            fullName:    m.fullName,
                            phone:       m.phone || null,
                            institution: m.institution || null,
                        },
                        include: { user: true },
                    })
                } else {
                    const existingUser = await tx.user.findUnique({
                        where: { email: m.email },
                        include: { participant: true },
                    })

                    if (existingUser?.participant) {
                        const err = new Error(`EMAIL_TAKEN:${m.email}`) as Error & { code: string }
                        err.code = 'EMAIL_TAKEN'
                        throw err
                    }

                    const user = existingUser ?? await tx.user.create({
                        data: { email: m.email, type: 'PARTICIPANT' },
                    })

                    participant = await tx.participant.create({
                        data: {
                            userId:      user.id,
                            cnic:        m.cnic,
                            email:       m.email,
                            fullName:    m.fullName,
                            phone:       m.phone || null,
                            institution: m.institution || null,
                        },
                        include: { user: true },
                    })
                }

                participantIds.push({ participantId: participant.id, isLeader })
            }

            const referenceId = refToUse || generateReferenceId()

            const seatUpdate = isEarlyBird
                ? await tx.competition.updateMany({
                      where: { id: competitionId, earlyBirdLimit: { gt: 0 } },
                      data: { earlyBirdLimit: { decrement: 1 } },
                  })
                : await tx.competition.updateMany({
                      where: { id: competitionId, capacityLimit: { gt: 0 } },
                      data: { capacityLimit: { decrement: 1 } },
                  })

            if (seatUpdate.count !== 1) {
                const err = new Error(isEarlyBird ? 'EARLY_BIRD_FULL' : 'CAPACITY_FULL') as Error & { code: string }
                err.code = isEarlyBird ? 'EARLY_BIRD_FULL' : 'CAPACITY_FULL'
                throw err
            }

            const team = await tx.team.create({
                data: {
                    name:            teamName,
                    competitionId,
                    referenceId,
                    paymentStatus:   RegistrationStatus.PENDING_PAYMENT,
                    paymentProofUrl: paymentProofUrl,
                    isEarlyBird,
                    members: {
                        create: participantIds.map((p) => ({
                            participantId: p.participantId,
                            isLeader:      p.isLeader,
                        })),
                    },
                },
                include: {
                    competition: { select: { name: true, fee: true } },
                    _count:      { select: { members: true } },
                },
            })

            return team
        }, { timeout: 20000 })

        res.status(201).json({
            success: true,
            data: {
                id:            result.id,
                teamName:      result.name,
                referenceId:   result.referenceId,
                paymentStatus: result.paymentStatus,
                paymentProofUrl,
                competition:   {
                    id:   result.competitionId,
                    name: result.competition.name,
                    fee:  result.competition.fee,
                },
                memberCount:   result._count.members,
            },
        })
    } catch (error: any) {
        console.error('[createPublicRegistration] Failed to create registration:', error)

        if (error?.code === 'EARLY_BIRD_FULL' || String(error?.message || '') === 'EARLY_BIRD_FULL') {
            res.status(409).json({
                success: false,
                message: 'Early Bird seats are full. Please register without Early Bird and pay the full amount.',
            })
            return
        }

        if (error?.code === 'CAPACITY_FULL' || String(error?.message || '') === 'CAPACITY_FULL') {
            res.status(409).json({ success: false, message: 'Module seats are full. Please register for a different module.' })
            return
        }

        if (error?.code === 'EMAIL_TAKEN' || error?.message?.startsWith('EMAIL_TAKEN:')) {
            const email = error?.message?.split(':')[1] || 'this email'
            res.status(400).json({
                success: false,
                message: `Email ${email} is already registered to another participant.`,
            })
            return
        }

        const prismaCode = error?.code as string
        if (prismaCode === 'P2002') {
            const target = (error?.meta?.target as string[]) || []
            const field = target[0] || 'record'
            res.status(409).json({
                success: false,
                message: `Duplicate entry: ${field} already exists.`,
            })
            return
        }

        const msg = error?.message || 'Failed to create registration.'
        res.status(500).json({ success: false, message: msg })
    }
}

export async function listPublicRegistrations(_req: Request, res: Response): Promise<void> {
    const teams = await prisma.team.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            competition: { select: { id: true, name: true, fee: true } },
            _count: { select: { members: true } },
        },
        take: 50,
    })

    res.json({
        success: true,
        data: teams.map((t) => ({
            id:            t.id,
            teamName:      t.name,
            referenceId:   t.referenceId,
            paymentStatus: t.paymentStatus,
            paymentProofUrl: t.paymentProofUrl,
            competition:   t.competition,
            memberCount:   t._count.members,
            createdAt:     t.createdAt,
        })),
    })
}

