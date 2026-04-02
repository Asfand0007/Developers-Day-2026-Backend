import { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../config/supabase'

export interface AuthRequest extends Request {
    userId?: string
    userRole?: string
}

// ─── In-memory token-verification cache ──────────────────────────────────────
// Avoids a Supabase network round-trip (~200-800 ms) on every request.
// Tokens are still verified by Supabase on first use; cached results are
// reused for TOKEN_CACHE_TTL_MS.  On serverless (Vercel) the cache lives
// only for the lifetime of the warm function instance.

interface CachedAuth {
    userId: string
    userRole: string | undefined
    cachedAt: number
}

const tokenCache   = new Map<string, CachedAuth>()
const TOKEN_CACHE_TTL_MS  = 2 * 60 * 1000   // 2 minutes
const TOKEN_CACHE_MAX     = 500              // cap to prevent unbounded growth

let lastCleanup = Date.now()
function pruneExpired() {
    const now = Date.now()
    if (now - lastCleanup < 30_000) return       // at most once per 30 s
    lastCleanup = now
    for (const [key, val] of tokenCache) {
        if (now - val.cachedAt > TOKEN_CACHE_TTL_MS) tokenCache.delete(key)
    }
}

export async function requireAuth(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
        res.status(401).json({ success: false, message: 'Authentication required.' })
        return
    }

    // ── Cache hit → skip Supabase network call ──────────────────────────────
    pruneExpired()
    const cached = tokenCache.get(token)
    if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
        req.userId   = cached.userId
        req.userRole = cached.userRole
        next()
        return
    }

    // ── Cache miss → verify with Supabase (one-time cost) ───────────────────
    const { data, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !data.user) {
        tokenCache.delete(token)
        res.status(401).json({ success: false, message: 'Invalid or expired token.' })
        return
    }

    const userId   = data.user.id
    const userRole = ((data.user.app_metadata?.role as string) ?? '').toUpperCase() || undefined

    // Evict oldest entry if at capacity
    if (tokenCache.size >= TOKEN_CACHE_MAX) {
        const oldest = tokenCache.keys().next().value
        if (oldest) tokenCache.delete(oldest)
    }
    tokenCache.set(token, { userId, userRole, cachedAt: Date.now() })

    req.userId   = userId
    req.userRole = userRole
    next()
}
