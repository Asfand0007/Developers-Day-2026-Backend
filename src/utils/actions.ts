import { prisma } from '../config/db'

// ─── All action IDs ────────────────────

export const ALL_ACTIONS = [
    'VIEW_REGISTRATION_DETAILS',
    'EDIT_COMPETITION',
    'VIEW_STALL_DETAILS',
    'ADD_NEW_STALL',
    'EDIT_STALL',
    'DELETE_STALL',
    'VIEW_ALL_COMPANIES',
    'ADD_NEW_COMPANY',
    'ASSIGN_BOOTH',
    'EDIT_COMPANY',
    'DELETE_COMPANY',
    'CREATE_NEW_REGISTRATION',
    'UPDATE_ATTENDANCE',
    'VIEW_ALL_PORTAL_USERS',
    'ASSIGN_ACTIONS_TO_USERS',
    'CREATE_ACCOUNTS',
    'UPDATE_PARTICIPANT_RECORD',
    'VIEW_AMBASSADOR_DASHBOARD',
    'MANAGE_AMBASSADORS',
] as const

export type ActionEnum = (typeof ALL_ACTIONS)[number]

// ─── Default actions per StaffRole ───────────────────────────────────────────

export const ROLE_DEFAULT_ACTIONS: Record<string, ActionEnum[]> = {
    COMPETITIONS: [
        'VIEW_REGISTRATION_DETAILS',
        'EDIT_COMPETITION',
    ],
    FOOD: [
        'VIEW_STALL_DETAILS',
        'ADD_NEW_STALL',
        'EDIT_STALL',
        'DELETE_STALL',
    ],
    GR: [
        'VIEW_ALL_COMPANIES',
        'ADD_NEW_COMPANY',
        'ASSIGN_BOOTH',
        'EDIT_COMPANY',
        'DELETE_COMPANY',
    ],
    PR: [
        'VIEW_REGISTRATION_DETAILS',
        'CREATE_NEW_REGISTRATION',
        'UPDATE_ATTENDANCE',
    ],
    EXCOM: [
        'VIEW_ALL_PORTAL_USERS',
        'VIEW_REGISTRATION_DETAILS',
    ],
    AMBASSADOR_MANAGEMENT: [
        'VIEW_AMBASSADOR_DASHBOARD',
        'MANAGE_AMBASSADORS',
    ],
    SUPERADMIN: [...ALL_ACTIONS],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function actionToKebab(action: string): string {
    return action.toLowerCase().replace(/_/g, '-')
}

export function kebabToAction(kebab: string): string {
    return kebab.toUpperCase().replace(/-/g, '_')
}

export function actionsToKebab(actions: string[]): string[] {
    return actions.map(actionToKebab)
}

// ─── In-memory permission cache ──────────────────────────────────────────────
// Avoids 2 Prisma queries (staffProfile + userAction) on every request that
// goes through requireAction.

interface CachedActions {
    actions: string[]
    cachedAt: number
}

const actionsCache = new Map<string, CachedActions>()
const ACTIONS_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Invalidate the cached actions for a specific user.
 * Call this after a super-admin grants / revokes actions.
 */
export function invalidateUserActionsCache(userId: string): void {
    actionsCache.delete(userId)
}

/**
 * Compute the effective set of actions for a user.
 * Effective = role-default actions ∪ extra actions granted by super-admin.
 * Results are cached in-memory for ACTIONS_CACHE_TTL_MS.
 */
export async function getUserEffectiveActions(userId: string): Promise<string[]> {
    const cached = actionsCache.get(userId)
    if (cached && Date.now() - cached.cachedAt < ACTIONS_CACHE_TTL_MS) {
        return cached.actions
    }

    // Fetch both in parallel to cut latency in half
    const [staffProfile, extraActions] = await Promise.all([
        prisma.staffProfile.findUnique({
            where: { id: userId },
            select: { staffRole: true },
        }),
        prisma.userAction.findMany({
            where: { userId },
            select: { action: true },
        }),
    ])

    if (!staffProfile) return []

    const roleDefaults = ROLE_DEFAULT_ACTIONS[staffProfile.staffRole] ?? []

    const allActions = new Set<string>([
        ...roleDefaults,
        ...extraActions.map((a: any) => a.action),
    ])

    const result = Array.from(allActions)
    actionsCache.set(userId, { actions: result, cachedAt: Date.now() })
    return result
}
