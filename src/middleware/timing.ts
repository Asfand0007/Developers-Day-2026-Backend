import { Request, Response, NextFunction } from 'express'

/**
 * Lightweight request-timing middleware.
 * Logs the HTTP method, path, status code, and duration of every request.
 *
 * Enabled by default in development; set LOG_TIMING=true in production
 * to keep it active for diagnostics.
 */
export function requestTiming(req: Request, res: Response, next: NextFunction): void {
    const enabled = process.env.LOG_TIMING === 'true' || process.env.NODE_ENV !== 'production'
    if (!enabled) { next(); return }

    const start = performance.now()

    res.on('finish', () => {
        const ms = (performance.now() - start).toFixed(1)
        const status = res.statusCode
        const flag = Number(ms) > 500 ? ' ⚠ SLOW' : ''
        console.log(`[timing] ${req.method} ${req.originalUrl} → ${status} (${ms} ms)${flag}`)
    })

    next()
}
