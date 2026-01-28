import express from "express";
import { getDashboardData } from "../controllers/dashboardController.js";
import {
  authenticate,
  authorizeAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", authenticate, authorizeAdmin, getDashboardData);

export default router;
