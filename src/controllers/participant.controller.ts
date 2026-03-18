import { Response } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../config/db'

// GET /participants/by-email?email=...

export async function getParticipantByEmail(req: AuthRequest, res: Response): Promise<void> {
    const email = (req.query.email as string)?.trim().toLowerCase() ?? ''

    if (!email) {
        res.status(400).json({ success: false, message: 'Email is required.' })
        return
    }

    const participant = await prisma.participant.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: {
            teamMembers: {
                include: {
                    team: {
                        include: {
                            competition: {
                                select: {
                                    id:        true,
                                    name:      true,
                                    compDay:   true,
                                    startTime: true,
                                    endTime:   true,
                                    fee:       true,
                                },
                            },
                            _count: { select: { members: true } },
                        },
                    },
                },
                orderBy: { joinedAt: 'desc' },
            },
        },
    })

    if (!participant) {
        res.status(404).json({ success: false, message: 'Participant not found.' })
        return
    }

    res.json({
        success: true,
        data: {
            participant: {
                id:          participant.id,
                fullName:    participant.fullName,
                email:       participant.email,
                cnic:        participant.cnic,
                phone:       participant.phone,
                institution: participant.institution,
                rollNumber:  participant.rollNumber
            },
            teams: participant.teamMembers.map((tm) => ({
                teamId:        tm.team.id,
                teamName:      tm.team.name,
                referenceId:   tm.team.referenceId,
                paymentStatus: tm.team.paymentStatus,
                isLeader:      tm.isLeader,
                memberCount:   tm.team._count.members,
                competition:   tm.team.competition,
            })),
        },
    })
}

const updateParticipantSchema = z.object({
    fullName:    z.string().min(1).optional(),
    email:       z.string().email().optional(),
    phone:       z.string().optional(),
    institution: z.string().optional(),
    cnic:        z.string().optional(),
    rollNumber:  z.string().optional(),
})

export async function updateParticipantRecord(req: AuthRequest, res: Response): Promise<void> {
    const participantId = String(req.params.id)
    const parsed = updateParticipantSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ success: false, errors: parsed.error.issues })
        return
    }

    const data = parsed.data
    if (Object.keys(data).length === 0) {
        res.status(400).json({ success: false, message: 'At least one field is required to update.' })
        return
    }

    try {
        const participant = await prisma.participant.update({
            where: { id: participantId },
            data,
        })

        res.json({
            success: true,
            data: {
                id:          participant.id,
                fullName:    participant.fullName,
                email:       participant.email,
                cnic:        participant.cnic,
                phone:       participant.phone,
                institution: participant.institution,
            },
        })
    } catch (error: any) {
        if (error?.code === 'P2002') {
            res.status(409).json({ success: false, message: 'Email or CNIC already in use.' })
            return
        }
        if (error?.code === 'P2025') {
            res.status(404).json({ success: false, message: 'Participant not found.' })
            return
        }
        console.error('[updateParticipantRecord] error:', error)
        res.status(500).json({ success: false, message: 'Failed to update participant record.' })
    }
}

