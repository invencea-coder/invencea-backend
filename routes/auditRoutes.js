// backend/routes/auditRoutes.js
import express from "express";
import { listAuditLogs } from "../controllers/auditController.js";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware.js";

const router = express.Router(); // 🔹 make sure this exists

// Apply auth middleware
router.get("/", authenticate, authorizeAdmin, listAuditLogs);

// ✅ Export default router
export default router;
