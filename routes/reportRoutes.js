// backend/routes/reportRoutes.js
import express from "express";
import {
  getReports,
  exportReportsExcel,
  exportReportsPDF,
  deleteReports, // <-- added
} from "../controllers/reportController.js";

import {
  authenticate,
  authorizeAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

/* ===============================
   REPORT ROUTES (ADMIN ONLY)
================================ */
router.get("/", authenticate, authorizeAdmin, getReports);
router.get("/export/excel", authenticate, authorizeAdmin, exportReportsExcel);
router.get("/export/pdf", authenticate, authorizeAdmin, exportReportsPDF);

// DELETE reports in a date range (owner-only)
router.delete("/", authenticate, authorizeAdmin, deleteReports);

export default router;
