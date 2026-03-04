import { Response } from 'express'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../config/db'
import { Prisma, RegistrationStatus, PaymentMethod } from '@prisma/client'
import { z } from 'zod'

// GET /registrations/competitions 

export async function listCompetitions(_req: AuthRequest, res: Response): Promise<void> {
    const competitions = await prisma.competition.findMany({
        select: { id: true, name: true, compDay: true, minTeamSize: true, maxTeamSize: true },
        orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: competitions })
}

//  GET /registrations 
// Query params: page, limit, search (name/referenceId/email), competitionId, status

export async function listRegistrations(req: AuthRequest, res: Response): Promise<void> {
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const skip  = (page - 1) * limit

    const search        = (req.query.search        as string)?.trim() ?? ''
    const competitionId = (req.query.competitionId as string)?.trim() || undefined
    const statusParam   = (req.query.status        as string)?.trim() || undefined

    // Build where clause
    const where: Prisma.TeamWhereInput = {}

    if (search) {
        where.OR = [
            { name:        { contains: search, mode: 'insensitive' } },
            { referenceId: { contains: search, mode: 'insensitive' } },
        ]
    }

    if (competitionId) {
        where.competitionId = competitionId
    }

    if (statusParam && Object.values(RegistrationStatus).includes(statusParam as RegistrationStatus)) {
        where.paymentStatus = statusParam as RegistrationStatus
    }

    const [total, teams] = await Promise.all([
        prisma.team.count({ where }),
        prisma.team.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                competition: { select: { id: true, name: true, compDay: true, fee: true } },
                _count:      { select: { members: true } },
            },
        }),
    ])

    res.json({
        success: true,
        data: teams.map((t) => ({
            id:            t.id,
            name:          t.name,
            referenceId:   t.referenceId,
            paymentStatus: t.paymentStatus,
            paymentMethod: t.paymentMethod,
            competition:   t.competition,
            memberCount:   t._count.members,
            createdAt:     t.createdAt,
        })),
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    })
}

// GET /registrations/:id 

export async function getRegistration(req: AuthRequest, res: Response): Promise<void> {
    const id = String(req.params.id)

    const team = await prisma.team.findUnique({
        where: { id },
        include: {
            competition: true,
            members: {
                include: {
                    participant: {
                        select: {
                            id:          true,
                            fullName:    true,
                            email:       true,
                            cnic:        true,
                            phone:       true,
                            institution: true,
                        },
                    },
                },
                orderBy: { isLeader: 'desc' },
            },
            attendance: {
                select: {
                    participantId: true,
                    status:        true,
                    method:        true,
                    markedAt:      true,
                },
            },
        },
    })

    if (!team) {
        res.status(404).json({ success: false, message: 'Registration not found.' })
        return
    }

    res.json({
        success: true,
        data: {
            id:              team.id,
            name:            team.name,
            referenceId:     team.referenceId,
            paymentStatus:   team.paymentStatus,
            paymentMethod:   team.paymentMethod,
            paymentDate:     team.paymentDate,
            declaredTID:     team.declaredTID,
            amountPaid:      team.amountPaid ? String(team.amountPaid) : null,
            paymentProofUrl: team.paymentProofUrl,
            createdAt:       team.createdAt,
            updatedAt:       team.updatedAt,
            competition:     team.competition,
            members: team.members.map((m) => {
                const att = team.attendance.find((a) => a.participantId === m.participantId)
                return {
                    id:           m.id,
                    isLeader:     m.isLeader,
                    cardIssued:   m.cardIssued,
                    cardIssuedAt: m.cardIssuedAt,
                    joinedAt:     m.joinedAt,
                    participant:  m.participant,
                    attendance: att
                        ? { status: att.status, method: att.method, markedAt: att.markedAt }
                        : null,
                }
            }),
        },
    })
}

//  GET /registrations/competitions-form

export async function listCompetitionsForForm(_req: AuthRequest, res: Response): Promise<void> {
    const competitions = await prisma.competition.findMany({
        select: {
            id: true, name: true, compDay: true, fee: true,
            minTeamSize: true, maxTeamSize: true,
            startTime: true, endTime: true,
        },
        orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: competitions })
}

// POST /registrations/check-clashes

const clashSchema = z.object({
    competitionId: z.string().min(1, 'Competition ID is required'),
    cnics: z.array(z.string().min(1)).min(1),
})

export async function checkClashes(req: AuthRequest, res: Response): Promise<void> {
    const parsed = clashSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ success: false, errors: parsed.error.issues })
        return
    }

    const { competitionId, cnics } = parsed.data

    // Get the target competition's timing
    const targetComp = await prisma.competition.findUnique({
        where: { id: competitionId },
        select: { id: true, name: true, startTime: true, endTime: true },
    })

    if (!targetComp) {
        res.status(404).json({ success: false, message: 'Competition not found.' })
        return
    }

    // Find participants by CNIC
    const participants = await prisma.participant.findMany({
        where: { cnic: { in: cnics } },
        select: { id: true, cnic: true, fullName: true },
    })

    if (participants.length === 0) {
        // No existing participants means no clashes possible
        res.json({ success: true, clashes: [] })
        return
    }

    // Find team memberships for those participants where the competition time overlaps
    const clashes = await prisma.teamMember.findMany({
        where: {
            participantId: { in: participants.map((p) => p.id) },
            team: {
                competition: {
                    id: { not: competitionId },
                    startTime: { lt: targetComp.endTime },
                    endTime:   { gt: targetComp.startTime },
                },
            },
        },
        select: {
            participant: { select: { fullName: true, cnic: true } },
            team: {
                select: {
                    name: true,
                    competition: { select: { name: true, startTime: true, endTime: true } },
                },
            },
        },
    })

    const formatted = clashes.map((c) => ({
        participantName: c.participant.fullName,
        participantCnic: c.participant.cnic,
        clashTeam:       c.team.name,
        clashCompetition: c.team.competition.name,
        clashStart:      c.team.competition.startTime,
        clashEnd:        c.team.competition.endTime,
    }))

    res.json({ success: true, clashes: formatted })
}

//  POST /registrations 

const memberSchema = z.object({
    fullName:    z.string().min(1, 'Full name is required'),
    email:       z.string().email('Invalid email'),
    cnic:        z.string().min(13, 'CNIC must be at least 13 characters'),
    phone:       z.string().optional().default(''),
    institution: z.string().optional().default(''),
    isLeader:    z.boolean(),
})

const createRegistrationSchema = z.object({
    teamName:      z.string().min(1, 'Team name is required'),
    competitionId: z.string().min(1, 'Competition ID is required'),
    referenceId:   z.string().min(1, 'Reference ID is required'),
    paymentMethod: z.nativeEnum(PaymentMethod),
    amountPaid:    z.string().min(1, 'Amount paid is required'),
    members:       z.array(memberSchema).min(1, 'At least one member is required'),
})

export async function createRegistration(req: AuthRequest, res: Response): Promise<void> {
    const parsed = createRegistrationSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ success: false, errors: parsed.error.issues })
        return
    }

    const { teamName, competitionId, referenceId, paymentMethod, amountPaid, members } = parsed.data

    // Validate competition exists
    const competition = await prisma.competition.findUnique({
        where: { id: competitionId },
        select: { id: true, minTeamSize: true, maxTeamSize: true, fee: true },
    })

    if (!competition) {
        res.status(404).json({ success: false, message: 'Competition not found.' })
        return
    }

    // Validate team size
    if (members.length < competition.minTeamSize || members.length > competition.maxTeamSize) {
        res.status(400).json({
            success: false,
            message: `Team must have between ${competition.minTeamSize} and ${competition.maxTeamSize} members.`,
        })
        return
    }

    // Validate exactly one leader
    const leaders = members.filter((m) => m.isLeader)
    if (leaders.length !== 1) {
        res.status(400).json({ success: false, message: 'Exactly one member must be the leader.' })
        return
    }

    // Check referenceId uniqueness
    const existingRef = await prisma.team.findUnique({ where: { referenceId } })
    if (existingRef) {
        res.status(409).json({ success: false, message: 'Reference ID already exists.' })
        return
    }

    // Upsert participants and build team in a transaction
    const result = await prisma.$transaction(async (tx) => {
        // Upsert each participant by CNIC
        const participantIds: { participantId: string; isLeader: boolean }[] = []

        for (const m of members) {
            // Check if a user with this email already exists
            let user = await tx.user.findUnique({ where: { email: m.email } })

            if (!user) {
                user = await tx.user.create({
                    data: { email: m.email, type: 'PARTICIPANT' },
                })
            }

            // Upsert participant by cnic
            let participant = await tx.participant.findUnique({ where: { cnic: m.cnic } })

            if (!participant) {
                participant = await tx.participant.create({
                    data: {
                        userId:      user.id,
                        cnic:        m.cnic,
                        email:       m.email,
                        fullName:    m.fullName,
                        phone:       m.phone || null,
                        institution: m.institution || null,
                    },
                })
            } else {
                // Update participant details (name, phone, institution may change)
                participant = await tx.participant.update({
                    where: { id: participant.id },
                    data: {
                        fullName:    m.fullName,
                        phone:       m.phone || null,
                        institution: m.institution || null,
                    },
                })
            }

            participantIds.push({ participantId: participant.id, isLeader: m.isLeader })
        }

        // Create team
        const team = await tx.team.create({
            data: {
                name:          teamName,
                competitionId,
                referenceId,
                paymentStatus: 'VERIFIED',
                paymentMethod,
                amountPaid:    parseFloat(amountPaid),
                paymentDate:   new Date(),
                members: {
                    create: participantIds.map((p) => ({
                        participantId: p.participantId,
                        isLeader:      p.isLeader,
                    })),
                },
            },
            include: {
                competition: { select: { name: true } },
                _count:      { select: { members: true } },
            },
        })

        return team
    })

    res.status(201).json({
        success: true,
        data: {
            id:          result.id,
            name:        result.name,
            referenceId: result.referenceId,
            competition: result.competition.name,
            memberCount: result._count.members,
        },
    })
}
