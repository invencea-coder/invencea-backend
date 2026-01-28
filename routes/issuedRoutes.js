// backend/routes/issuedRoutes.js
import express from 'express';
import { getIssuedItems } from '../controllers/issuedController.js';
import { authenticate, authorizeAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/borrow-requests/issued', authenticate, authorizeAdmin, getIssuedItems);

export default router;