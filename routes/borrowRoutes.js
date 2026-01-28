import express from "express";
import {
  createBorrowRequest,
  listBorrowRequests,
  updateBorrowStatus,
  getMyBorrowRequests,
} from "../controllers/borrowController.js";

import {
  returnByBarcode,
  getReturnOptions,
} from "../controllers/returnController.js";

import {
  authenticate,
  authorizeAdmin,
  authorizeKiosk,
} from "../middleware/authMiddleware.js";

import { validateBorrowRequest } from "../middleware/borrowValidation.js";

const router = express.Router();

/* ===============================
   CREATE borrow request
   - allow kiosk AND faculty (and admin for testing)
   - validateBorrowRequest should be permissive for faculty (no student id required)
================================ */
router.post(
  "/",
  authenticate,
  authorizeKiosk, // now allows kiosk, faculty, admin
  validateBorrowRequest,
  createBorrowRequest
);

/* ===============================
   View own borrow history
   - allow kiosk & faculty to view their branch-scoped requests
================================ */
router.get(
  "/mine",
  authenticate,
  authorizeKiosk, // now allows kiosk, faculty, admin
  getMyBorrowRequests
);

/* ===============================
   ADMIN: List borrow requests
================================ */
router.get(
  "/",
  authenticate,
  authorizeAdmin,
  listBorrowRequests
);

/* ===============================
   ADMIN: Approve / Deny / Issue
================================ */
router.post(
  "/:id/status",
  authenticate,
  authorizeAdmin,
  updateBorrowStatus
);

/* ===============================
   ADMIN: Return helpers
================================ */
router.get(
  "/return-options",
  authenticate,
  authorizeAdmin,
  getReturnOptions
);

router.post(
  "/return-by-barcode",
  authenticate,
  authorizeAdmin,
  returnByBarcode
);

export default router;
