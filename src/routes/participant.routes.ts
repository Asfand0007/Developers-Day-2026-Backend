import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireAction } from '../middleware/permission'
import { getParticipantByEmail } from '../controllers/participant.controller'

const router = Router()

// GET /participants/by-email?email=...
router.get(
    '/by-email',
    requireAuth,
    requireAction('UPDATE_PARTICIPANT_RECORD'),
    getParticipantByEmail
)

export default router
