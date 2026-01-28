// backend/routes/returnRoutes.js
import express from "express";
import { getReturnOptions, returnByBarcode } from "../controllers/returnController.js";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/borrow-requests/return-options?barcode=XXX
router.get("/return-options", authenticate, authorizeAdmin, getReturnOptions);

// POST /api/borrow-requests/return-by-barcode
router.post("/return-by-barcode", authenticate, authorizeAdmin, returnByBarcode);

export default router;
