import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireAction } from '../middleware/permission'
import {
    getParticipantByEmail,
    updateParticipantRecord,
} from '../controllers/participant.controller'

const router = Router()

// GET /participants/by-email?email=...
router.get(
    '/by-email',
    requireAuth,
    requireAction('UPDATE_PARTICIPANT_RECORD'),
    getParticipantByEmail
)

// PATCH /participants/:id
router.patch(
    '/:id',
    requireAuth,
    requireAction('UPDATE_PARTICIPANT_RECORD'),
    updateParticipantRecord
)

export default router
