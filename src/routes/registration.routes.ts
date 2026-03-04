import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireAction } from '../middleware/permission'
import {
    listCompetitions,
    listCompetitionsForForm,
    listRegistrations,
    getRegistration,
    checkClashes,
    createRegistration,
} from '../controllers/registration.controller'

const router = Router()

router.get(
    '/competitions',
    requireAuth,
    requireAction('VIEW_REGISTRATION_DETAILS'),
    listCompetitions
)

// GET /registrations/competitions-form
router.get(
    '/competitions-form',
    requireAuth,
    requireAction('CREATE_NEW_REGISTRATION'),
    listCompetitionsForForm
)

// POST /registrations/check-clashes
router.post(
    '/check-clashes',
    requireAuth,
    requireAction('CREATE_NEW_REGISTRATION'),
    checkClashes
)

// POST /registrations — create a new registration
router.post(
    '/',
    requireAuth,
    requireAction('CREATE_NEW_REGISTRATION'),
    createRegistration
)

// GET /registrations
router.get(
    '/',
    requireAuth,
    requireAction('VIEW_REGISTRATION_DETAILS'),
    listRegistrations
)

// GET /registrations/:id
router.get(
    '/:id',
    requireAuth,
    requireAction('VIEW_REGISTRATION_DETAILS'),
    getRegistration
)

export default router
