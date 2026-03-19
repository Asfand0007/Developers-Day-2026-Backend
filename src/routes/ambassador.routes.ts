import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { requireAction } from '../middleware/permission'
import {
    getAllBrandAmbassadorsPublic,
    listAmbassadors,
    createAmbassador,
    updateAmbassador,
    deleteAmbassador,
} from '../controllers/ambassador.controller'

const router = Router()

// GET /abassadors/public — list ambassadors (no auth)
router.get('/public', getAllBrandAmbassadorsPublic)

// GET  /ambassadors       — list all brand ambassadors
router.get('/',    requireAuth, requireAction('VIEW_AMBASSADOR_DASHBOARD'), listAmbassadors)

// POST /ambassadors       — create new brand ambassador
router.post('/',   requireAuth, requireAction('MANAGE_AMBASSADORS'), createAmbassador)

// PATCH /ambassadors/:id  — update ambassador
router.patch('/:id', requireAuth, requireAction('MANAGE_AMBASSADORS'), updateAmbassador)

// DELETE /ambassadors/:id — delete ambassador
router.delete('/:id', requireAuth, requireAction('MANAGE_AMBASSADORS'), deleteAmbassador)

export default router
