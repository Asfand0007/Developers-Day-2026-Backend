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
    searchTeams,
    searchTeamMembers,
    markTeamAttendance,
    changeTeamCompetition,
    updateTeamPaymentStatus,
    getDashboardStats,
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

// GET /registrations/search?q=<query>
router.get(
    '/search',
    requireAuth,
    requireAction('UPDATE_ATTENDANCE'),
    searchTeams
)

// GET /registrations/search-members?query=<query>
router.get(
    '/search-members',
    requireAuth,
    requireAction('VIEW_REGISTRATION_DETAILS'),
    searchTeamMembers
)



// GET /registrations/dashboard-stats  ← MUST be before /:id
router.get(
    '/dashboard-stats',
    requireAuth,
    requireAction('VIEW_REGISTRATION_DETAILS'),
    getDashboardStats
)

// POST /registrations/:teamId/mark-attendance
router.post(
    '/:teamId/mark-attendance',
    requireAuth,
    requireAction('UPDATE_ATTENDANCE'),
    markTeamAttendance
)

// GET /registrations/:id
router.get(
    '/:id',
    requireAuth,
    requireAction('VIEW_REGISTRATION_DETAILS'),
    getRegistration
)

// PATCH /registrations/:teamId/payment-status
router.patch(
    '/:teamId/payment-status',
    requireAuth,
    requireAction('UPDATE_PARTICIPANT_RECORD'),
    updateTeamPaymentStatus
)

// PATCH /registrations/:teamId/change-competition
router.patch(
    '/:teamId/change-competition',
    requireAuth,
    requireAction('UPDATE_PARTICIPANT_RECORD'),
    changeTeamCompetition
)

export default router
