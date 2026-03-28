import { Request, Response } from 'express'
import { prisma } from '../config/db'
import { UserType } from '@prisma/client'
import { AuthRequest } from '../middleware/auth'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateReferralCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const rand6 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    return `${rand6}-DD26`
}

// ─── GET public/ambassadors ────────────────────────────────────────────────────────

export const getAllBrandAmbassadorsPublic = async (req: Request, res: Response): Promise<void> => {
  try {
    const ambassadors = await prisma.brandAmbassador.findMany({
      select: {
        id: true,
        fullName: true,
        institute: true,
        referralCode: true,
        phone: true,
        cnic: true,
        createdAt: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    // Count teams per referral code in a single aggregation query
    const referralCounts = await prisma.team.groupBy({
      by: ["referenceId"],
      _count: {
        id: true,
      },
    });

    // Build a lookup map: referralCode -> teamCount
    const countMap = new Map<string, number>(
      referralCounts.map(({ referenceId, _count }) => [
        referenceId,
        _count.id,
      ])
    );

    const data = ambassadors.map((ambassador) => ({
      id: ambassador.id,
      fullName: ambassador.fullName,
      email: ambassador.user.email,
      institute: ambassador.institute,
      phone: ambassador.phone ?? null,
      cnic: ambassador.cnic,
      referralCode: ambassador.referralCode,
      teamCount: countMap.get(ambassador.referralCode) ?? 0,
      createdAt: ambassador.createdAt,
    }));

    res.status(200).json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    console.error("[getAllBrandAmbassadors]", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch brand ambassadors",
    });
  }
};

// ─── GET /ambassadors ────────────────────────────────────────────────────────

export async function listAmbassadors(_req: AuthRequest, res: Response): Promise<void> {
    const ambassadors = await prisma.brandAmbassador.findMany({
        include: {
            user: { select: { email: true, isActive: true, createdAt: true } },
        },
        orderBy: { fullName: 'asc' },
    })

    const referralCounts = await prisma.team.groupBy({
      by: ["referenceId"],
      _count: {
        id: true,
      },
    });

    const countMap = new Map<string, number>(
      referralCounts.map(({ referenceId, _count }) => [
        referenceId,
        _count.id,
      ])
    );

    res.json({
        success: true,
        data: ambassadors.map((a) => ({
            id:             a.id,
            fullName:       a.fullName,
            cnic:           a.cnic,
            institute:      a.institute,
            referralCode:   a.referralCode,
            totalReferrals: countMap.get(a.referralCode) ?? 0,
            email:          a.user.email,
            isActive:       a.user.isActive,
            registeredAt:   a.user.createdAt.toISOString(),
        })),
    })
}

// ─── POST /ambassadors ────────────────────────────────────────────────────────

export async function createAmbassador(req: AuthRequest, res: Response): Promise<void> {
    const { fullName, email, cnic, institute } = req.body as {
        fullName:  string
        email:     string
        cnic:      string
        institute: string
    }

    if (!fullName || !email || !cnic || !institute) {
        res.status(400).json({ success: false, message: 'fullName, email, cnic, and institute are required.' })
        return
    }

    // Check if an ambassador with this CNIC already exists (real conflict)
    const existingBaCnic = await prisma.brandAmbassador.findUnique({ where: { cnic } })
    if (existingBaCnic) {
        res.status(409).json({ success: false, message: 'A brand ambassador with this CNIC already exists.' })
        return
    }

    // Find existing user by email OR by CNIC (through Participant profile)
    interface UserWithBa {
        id: string; email: string; isActive: boolean; createdAt: Date
        brandAmbassador: { id: string } | null
    }

    let existingUser: UserWithBa | null = await prisma.user.findUnique({
        where: { email },
        include: { brandAmbassador: true },
    }) as UserWithBa | null

    // Also check if a participant with this CNIC already has a user
    if (!existingUser) {
        const existingParticipant = await prisma.participant.findUnique({
            where: { cnic },
            include: { user: { include: { brandAmbassador: true } } },
        })
        if (existingParticipant) {
            existingUser = existingParticipant.user as UserWithBa
        }
    }

    // If user already has an ambassador profile, conflict
    if (existingUser?.brandAmbassador) {
        res.status(409).json({ success: false, message: 'This user is already registered as a brand ambassador.' })
        return
    }

    // Ensure referral code is unique (retry up to 5 times on collision)
    let referralCode = generateReferralCode()
    for (let i = 0; i < 5; i++) {
        const collision = await prisma.brandAmbassador.findUnique({ where: { referralCode } })
        if (!collision) break
        referralCode = generateReferralCode()
    }

    let user: { id: string; email: string; isActive: boolean; createdAt: Date; brandAmbassador: { id: string; fullName: string; cnic: string; institute: string; referralCode: string; totalReferrals: number } | null }

    if (existingUser) {
        // Attach ambassador profile to existing user
        const ba = await prisma.brandAmbassador.create({
            data: { userId: existingUser.id, fullName, cnic, institute, referralCode },
        })
        user = {
            id:        existingUser.id,
            email:     existingUser.email,
            isActive:  existingUser.isActive,
            createdAt: existingUser.createdAt,
            brandAmbassador: ba,
        }
    } else {
        // Create brand-new user + ambassador
        user = await prisma.user.create({
            data: {
                email,
                type:     UserType.PARTICIPANT,
                isActive: true,
                brandAmbassador: {
                    create: { fullName, cnic, institute, referralCode },
                },
            },
            include: { brandAmbassador: true },
        })
    }

    const ba = user.brandAmbassador!
    res.status(201).json({
        success: true,
        message: 'Brand ambassador created successfully.',
        data: {
            id:             ba.id,
            fullName:       ba.fullName,
            cnic:           ba.cnic,
            institute:      ba.institute,
            referralCode:   ba.referralCode,
            totalReferrals: ba.totalReferrals,
            email:          user.email,
            isActive:       user.isActive,
            registeredAt:   user.createdAt.toISOString(),
        },
    })
}

// ─── PATCH /ambassadors/:id ───────────────────────────────────────────────────

export async function updateAmbassador(req: AuthRequest, res: Response): Promise<void> {
    const id = req.params.id as string
    const { fullName, email, cnic, institute, isActive, regenerateCode } = req.body as {
        fullName?:       string
        email?:          string
        cnic?:           string
        institute?:      string
        isActive?:       boolean
        regenerateCode?: boolean
    }

    const ba = await prisma.brandAmbassador.findUnique({ where: { id }, include: { user: true } })
    if (!ba) {
        res.status(404).json({ success: false, message: 'Ambassador not found.' })
        return
    }

    if (email && email !== ba.user.email) {
        const clash = await prisma.user.findUnique({ where: { email } })
        if (clash) { res.status(409).json({ success: false, message: 'Email already in use.' }); return }
    }
    if (cnic && cnic !== ba.cnic) {
        const clash = await prisma.brandAmbassador.findUnique({ where: { cnic } })
        if (clash) { res.status(409).json({ success: false, message: 'CNIC already in use by another ambassador.' }); return }
    }

    let newReferralCode: string | undefined
    if (regenerateCode) {
        newReferralCode = generateReferralCode()
        for (let i = 0; i < 5; i++) {
            const collision = await prisma.brandAmbassador.findUnique({ where: { referralCode: newReferralCode } })
            if (!collision) break
            newReferralCode = generateReferralCode()
        }
    }

    const [updatedUser, updatedBa] = await prisma.$transaction([
        prisma.user.update({
            where: { id: ba.userId },
            data:  {
                ...(email    !== undefined ? { email }    : {}),
                ...(isActive !== undefined ? { isActive } : {}),
            },
        }),
        prisma.brandAmbassador.update({
            where: { id },
            data:  {
                ...(fullName       ? { fullName }       : {}),
                ...(cnic           ? { cnic }           : {}),
                ...(institute      ? { institute }      : {}),
                ...(newReferralCode ? { referralCode: newReferralCode } : {}),
            },
        }),
    ])

    res.json({
        success: true,
        message: 'Ambassador updated successfully.',
        data: {
            id:             updatedBa.id,
            fullName:       updatedBa.fullName,
            cnic:           updatedBa.cnic,
            institute:      updatedBa.institute,
            referralCode:   updatedBa.referralCode,
            totalReferrals: updatedBa.totalReferrals,
            email:          updatedUser.email,
            isActive:       updatedUser.isActive,
            registeredAt:   ba.user.createdAt.toISOString(),
        },
    })
}

// ─── DELETE /ambassadors/:id ──────────────────────────────────────────────────

export async function deleteAmbassador(req: AuthRequest, res: Response): Promise<void> {
    const id = req.params.id as string

    const ba = await prisma.brandAmbassador.findUnique({
        where: { id },
        include: {
            user: {
                include: {
                    staffProfile: true,
                    participant:  true,
                    company:      true,
                    foodStall:    true,
                },
            },
        },
    })
    if (!ba) {
        res.status(404).json({ success: false, message: 'Ambassador not found.' })
        return
    }

    // Only delete the BrandAmbassador row — keep the User intact
    // if they also have other profiles (staff, participant, etc.)
    const hasOtherProfiles =
        ba.user.staffProfile ||
        ba.user.participant  ||
        ba.user.company      ||
        ba.user.foodStall

    if (hasOtherProfiles) {
        // Just remove the ambassador profile
        await prisma.brandAmbassador.delete({ where: { id } })
    } else {
        // User has no other profiles — safe to delete the entire User (cascades)
        await prisma.user.delete({ where: { id: ba.userId } })
    }

    res.json({ success: true, message: 'Ambassador deleted successfully.' })
}
