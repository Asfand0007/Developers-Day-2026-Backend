import { Response } from 'express'
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
