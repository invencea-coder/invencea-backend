import express from "express";

import {
  listInventory,
  addInventory,
  updateInventory,
  deleteInventory,
  getInventoryHistory,
} from "../controllers/inventoryController.js";

import {
  borrowInventory,
  returnInventory,
} from "../controllers/inventoryTransactionController.js";

import { authenticate, authorizeAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ===============================
   AUTH REQUIRED FOR ALL ROUTES
================================ */
router.use(authenticate);

/* ===============================
   INVENTORY CRUD
================================ */

// GET inventory (branch-scoped)
router.get("/", listInventory);

// ADD inventory (ADMIN ONLY)
router.post("/", authorizeAdmin, addInventory);

// UPDATE inventory
// - Admin edits total_quantity + metadata
// - Automatically adjusts available_quantity
router.put("/:id", authorizeAdmin, updateInventory);

// DELETE inventory (ADMIN ONLY)
// - Allowed even if quantities are not zero
router.delete("/:id", authorizeAdmin, deleteInventory);

/* ===============================
   INVENTORY HISTORY
================================ */

// View edit & audit history
router.get("/:id/history", getInventoryHistory);

/* ===============================
   INVENTORY TRANSACTIONS
================================ */

// Borrow item (reduces available_quantity)
router.post("/:id/borrow", borrowInventory);

// Return item (increases available_quantity)
router.post("/:id/return", returnInventory);

export default router;
