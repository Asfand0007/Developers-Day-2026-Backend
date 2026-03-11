import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireAction } from '../middleware/permission'
import {
    listCompetitions,
    listCompetitionsWithCategory,
    getPublicCompetitionById,
    updateCompetitionTime,
    updateCompetitionVenues,
} from '../controllers/competition.controller'

const router = Router()

// GET /competitions/public — public list with category
router.get('/public', listCompetitionsWithCategory)

// GET /competitions/public/:id — public competition detail
router.get('/public/:id', getPublicCompetitionById)

// GET /competitions — admin list of competitions
router.get('/', requireAuth, requireAction('EDIT_COMPETITION'), listCompetitions)

// PATCH /competitions/:id/time — update start/end time
const updateTimeSchema = z.object({
    startTime: z.string().min(1, 'startTime is required'),
    endTime:   z.string().min(1, 'endTime is required'),
})

router.patch(
    '/:id/time',
    requireAuth,
    requireAction('EDIT_COMPETITION'),
    validate(updateTimeSchema),
    updateCompetitionTime
)

// PUT /competitions/:id/venues — replace all venues
const updateVenuesSchema = z.object({
    venues: z.array(z.string().min(1)).default([]),
})

router.put(
    '/:id/venues',
    requireAuth,
    requireAction('EDIT_COMPETITION'),
    validate(updateVenuesSchema),
    updateCompetitionVenues
)

export default router
