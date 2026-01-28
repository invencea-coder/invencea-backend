// backend/middleware/borrowValidation.js

export const validateBorrowRequest = (req, res, next) => {
  try {
    const { requester_name, requester_id, items, branch_id } = req.body;
    const role = (req.user?.role || "").toLowerCase();

    /* ===============================
       Common required fields
    ================================ */
    if (!requester_name || typeof requester_name !== "string" || !requester_name.trim()) {
      return res.status(400).json({ message: "Requester name is required" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "At least one item is required" });
    }

    for (const it of items) {
      if (!it.item_id) {
        return res.status(400).json({ message: "Each item must have item_id" });
      }
      if (!Number.isFinite(Number(it.quantity)) || Number(it.quantity) < 1) {
        return res.status(400).json({ message: "Each item must have quantity >= 1" });
      }
    }

    if (!branch_id) {
      return res.status(400).json({ message: "branch_id is required" });
    }

    /* ===============================
       Role-specific rules
    ================================ */

    // KIOSK / ADMIN FLOW → requester_id REQUIRED
    if (role === "kiosk" || role === "admin") {
      if (!requester_id || typeof requester_id !== "string") {
        return res.status(400).json({ message: "Student ID is required" });
      }

      const normalized = requester_id.trim();

      // Allow:
      //  - XXXX-XXXXX  (4-5)
      //  - XXXX-XXXXXX (4-6)
      const SCHOOL_ID_REGEX = /^\d{4}-\d{5,6}$/;

      if (!SCHOOL_ID_REGEX.test(normalized)) {
        return res.status(400).json({
          message: "Student ID must match format XXXX-XXXXX or XXXX-XXXXXX",
        });
      }

      req.body.requester_id = normalized;
    }

    // FACULTY FLOW → requester_id OPTIONAL
    if (role === "faculty") {
      if (!requester_id || !String(requester_id).trim()) {
        req.body.requester_id = null;
      } else {
        req.body.requester_id = String(requester_id).trim();
      }
    }

    next();
  } catch (err) {
    console.error("validateBorrowRequest error:", err);
    return res.status(400).json({ message: "Invalid borrow request payload" });
  }
};
