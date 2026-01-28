// invencea-backend/src/controllers/borrowController.js
import { supabase } from "../config/supabaseClient.js";
import { logAudit } from "../utils/auditLogger.js";

/**
 * Create borrow request
 * - kiosk: requires requester_id in allowed format; kiosk_id set to req.user.id; branch from req.user.branch_id
 * - faculty: requester_id optional; branch_id must be provided by frontend (selected branch) or fallback to user branch
 * - items: must be an array of { item_id, quantity }
 */
export const createBorrowRequest = async (req, res) => {
  try {
    const {
      requester_name,
      requester_id: providedRequesterId,
      items,
      note,
      branch_id: providedBranch,
    } = req.body;

    const role = (req.user?.role || "").toString().toLowerCase();
    const actorId = req.user?.id ?? null;

    // Basic validation
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
      const qty = Number(it.quantity || 0);
      if (!Number.isFinite(qty) || qty < 1) {
        return res.status(400).json({ message: "Each item must have quantity >= 1" });
      }
    }

    // Branch determination
    const branch_id = role === "kiosk" ? req.user?.branch_id : providedBranch || req.user?.branch_id || null;
    if (!branch_id) {
      return res.status(400).json({ message: "branch_id is required" });
    }

    // requester_id handling
    // Accept both formats: XXXX-XXXXX (4-5) and XXXX-XXXXXX (4-6)
    let requester_id = null;
    if (role === "kiosk" || role === "admin") {
      if (!providedRequesterId || typeof providedRequesterId !== "string") {
        return res.status(400).json({ message: "Student ID is required for kiosk/admin" });
      }
      const normalized = providedRequesterId.trim();
      const SCHOOL_ID_REGEX = /^\d{4}-\d{5,6}$/;
      if (!SCHOOL_ID_REGEX.test(normalized)) {
        return res.status(400).json({
          message: "Student ID must match format XXXX-XXXXX or XXXX-XXXXXX",
        });
      }
      requester_id = normalized;
    } else {
      // faculty: optional — accept provided value or null (no format enforcement)
      requester_id =
        providedRequesterId && String(providedRequesterId).trim()
          ? String(providedRequesterId).trim()
          : null;
    }

    // kiosk_id only for kiosk users
    const kiosk_id = role === "kiosk" ? actorId : null;

    const payload = {
      kiosk_id,
      branch_id,
      // keep both student_* and requester_* fields for compatibility with existing schema/UI
      student_name: requester_name.trim(),
      student_id: requester_id,
      requester_name: requester_name.trim(),
      requester_id: requester_id,
      items,
      note: note || null,
      status: "PENDING",
    };

    const { data, error } = await supabase.from("borrow_requests").insert(payload).select().single();

    if (error || !data) {
      console.error("CREATE BORROW ERROR:", error || data);
      // If DB complains about NOT NULL on some column, it will show in logs — return safe message
      return res.status(500).json({ message: "Failed to create borrow request" });
    }

    // Audit
    await logAudit({
      branch_id,
      actor_id: actorId,
      actor_role: role === "kiosk" ? "KIOSK" : role === "admin" ? "ADMIN" : "FACULTY",
      action_type: "BORROW",
      snapshot: { request_id: data.id, items: data.items, note: data.note },
    });

    return res.status(201).json(data);
  } catch (err) {
    console.error("CREATE BORROW ERROR:", err);
    return res.status(500).json({ message: "Failed to create borrow request" });
  }
};

/**
 * Get "my" borrow requests
 * - kiosk: returns records where kiosk_id === req.user.id (and branch)
 * - faculty: accepts optional branch_id query param (frontend passes selected branch)
 *   and returns best-effort matches where:
 *     - requester_id === req.user.id (if faculty stored their id as requester_id)
 *     - OR requester_name === req.user.full_name
 *     - OR request has no requester_id but requester_name matches user's name
 */
export const getMyBorrowRequests = async (req, res) => {
  try {
    const userRole = (req.user?.role || "").toString().toLowerCase();
    const actorId = req.user?.id;
    const actorName = req.user?.full_name || req.user?.name || null;

    // prefer explicit query param branch_id (frontend passes selected branch), fallback to user's branch
    const branch_id = req.query?.branch_id ?? req.user?.branch_id ?? null;

    if (!branch_id) {
      return res.status(400).json({ message: "branch_id required" });
    }

    // fetch branch-scoped rows
    const { data, error } = await supabase
      .from("borrow_requests")
      .select("*")
      .eq("branch_id", branch_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET MY BORROW ERR (fetch):", error);
      return res.status(500).json({ message: "Failed to fetch borrow requests" });
    }

    const rows = Array.isArray(data) ? data : [];

    if (userRole === "kiosk") {
      const filtered = rows.filter((r) => r.kiosk_id === actorId);
      return res.json(filtered);
    }

    if (userRole === "faculty") {
      const filtered = rows.filter((r) => {
        // If requester_id was set to actorId (possible), match that
        if (r.requester_id && actorId && String(r.requester_id) === String(actorId)) return true;

        // match by requester_name === actorName
        if (actorName && r.requester_name && String(r.requester_name).trim() === String(actorName).trim())
          return true;

        // match rows with empty requester_id but matching name
        if ((!r.requester_id || r.requester_id === null || r.requester_id === "") && actorName && String(r.requester_name || "").trim() === String(actorName).trim())
          return true;

        return false;
      });

      return res.json(filtered);
    }

    // other roles: deny
    return res.status(403).json({ message: "Not allowed" });
  } catch (err) {
    console.error("MY BORROW HISTORY ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch borrow history" });
  }
};

/**
 * Admin: list borrow requests (used for reporting)
 * - Uses req.user.branch_id (caller must be admin)
 * - Supports query params for filtering: status, from, to, search, limit, offset
 * - Enriches each request's items with inventory item_name where available
 */
export const listBorrowRequests = async (req, res) => {
  try {
    const branch_id = req.user?.branch_id;
    if (!branch_id) {
      return res.status(400).json({ message: "branch_id required" });
    }

    // optional filters
    const status = req.query?.status;
    const dateFrom = req.query?.from; // ISO date
    const dateTo = req.query?.to; // ISO date
    const search = req.query?.search; // free text search against requester_name or requester_id
    const limit = Math.min(Number(req.query?.limit || 200), 2000);
    const offset = Number(req.query?.offset || 0);

    // base query
    let query = supabase
      .from("borrow_requests")
      .select("id, requester_name, requester_id, student_name, student_id, items, note, status, created_at, approved_at, issued_at, returned_at, approved_by, issued_by, returned_by, kiosk_id, branch_id, admin_id")
      .eq("branch_id", branch_id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);
    if (search) {
      // supabase simple text match: use ilike on requester_name or requester_id
      query = query.or(`requester_name.ilike.%${search}%,requester_id.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("LIST BORROW ERROR (fetch):", error);
      return res.status(500).json({ message: "Failed to fetch borrow requests" });
    }

    const rows = Array.isArray(data) ? data : [];

    // Collect unique inventory item_ids across all requests to enrich names
    const itemIdSet = new Set();
    for (const r of rows) {
      if (Array.isArray(r.items)) {
        for (const it of r.items) {
          if (it && it.item_id) itemIdSet.add(it.item_id);
        }
      }
    }
    const itemIds = Array.from(itemIdSet);

    let inventoryMap = {};
    if (itemIds.length > 0) {
      const { data: invData, error: invError } = await supabase
        .from("inventory")
        .select("id, item_name, total_quantity, borrowed_quantity, unserviceable_quantity, available_quantity")
        .in("id", itemIds);

      if (invError) {
        console.error("LIST BORROW ERROR (inv fetch):", invError);
      } else if (Array.isArray(invData)) {
        inventoryMap = invData.reduce((m, i) => {
          m[i.id] = i;
          return m;
        }, {});
      }
    }

    // Enrich rows
    const enriched = rows.map((r) => {
      const items = Array.isArray(r.items)
        ? r.items.map((it) => ({
            ...it,
            item_name: (inventoryMap[it.item_id] && inventoryMap[it.item_id].item_name) || null,
            inventory_meta: inventoryMap[it.item_id] || null,
          }))
        : [];
      return { ...r, items };
    });

    return res.json(enriched);
  } catch (err) {
    console.error("LIST BORROW ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch borrow requests" });
  }
};

/**
 * Update borrow status (admin only)
 * - Validates allowed transitions
 * - APPROVED: checks availability
 * - ISSUED: calls RPC to issue items, sets issued_at/issued_by
 * - Writes audit log
 */
export const updateBorrowStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: nextStatusRaw } = req.body;
    const adminId = req.user?.id;
    const branch_id = req.user?.branch_id;

    if (!id || !nextStatusRaw) {
      return res.status(400).json({ message: "Request id and status are required" });
    }

    const nextStatus = String(nextStatusRaw).toUpperCase();

    // Valid transitions
    const VALID_TRANSITIONS = {
      PENDING: ["APPROVED", "DENIED"],
      APPROVED: ["ISSUED", "DENIED"],
      ISSUED: ["RETURNED"],
      RETURNED: [],
      DENIED: [],
    };

    // Load the borrow request
    const { data: request, error: fetchReqErr } = await supabase
      .from("borrow_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchReqErr || !request) {
      console.error("UPDATE STATUS: fetch error", fetchReqErr);
      return res.status(404).json({ message: "Borrow request not found" });
    }

    // Branch check
    if (request.branch_id !== branch_id) {
      return res.status(403).json({ message: "Unauthorized branch access" });
    }

    const currentStatus = String(request.status || "").toUpperCase();
    if (!(VALID_TRANSITIONS[currentStatus] || []).includes(nextStatus)) {
      return res.status(400).json({ message: `Invalid transition ${currentStatus} → ${nextStatus}` });
    }

    // APPROVAL: check availability
    if (nextStatus === "APPROVED") {
      for (const item of request.items || []) {
        const { data: inv, error: invErr } = await supabase
          .from("inventory")
          .select("total_quantity, borrowed_quantity, unserviceable_quantity, available_quantity")
          .eq("id", item.item_id)
          .single();

        if (invErr || !inv) {
          return res.status(400).json({ message: `Inventory item not found: ${item.item_id}` });
        }

        const available =
          typeof inv.available_quantity === "number"
            ? inv.available_quantity
            : (inv.total_quantity || 0) - (inv.borrowed_quantity || 0) - (inv.unserviceable_quantity || 0);

        if (Number(item.quantity) > available) {
          return res.status(400).json({
            message: `Requested quantity exceeds available stock`,
            item_id: item.item_id,
            requested: item.quantity,
            available,
          });
        }
      }
    }

    // ISSUED: call safe RPC
    if (nextStatus === "ISSUED") {
      for (const item of request.items || []) {
        const qty = Number(item.quantity || 0);
        if (!Number.isInteger(qty) || qty <= 0) {
          return res.status(400).json({ message: `Invalid quantity for item ${item.item_id}` });
        }

        const { error: rpcErr } = await supabase.rpc("issue_inventory_item", {
  p_item_id: item.item_id,
  p_user_id: adminId,
  p_quantity: qty,
  p_borrow_request_id: id,
});


        if (rpcErr) {
          console.error("ISSUE RPC error:", rpcErr);
          return res.status(400).json({ message: rpcErr.message || `Failed to issue item ${item.item_id}` });
        }
      }
    }

    // Build update payload
    const updateData = { status: nextStatus, admin_id: adminId };

    if (nextStatus === "APPROVED") {
      updateData.approved_at = new Date().toISOString();
      if (!request.approved_by) updateData.approved_by = adminId;
    }

    if (nextStatus === "ISSUED") {
      updateData.issued_at = new Date().toISOString();
      updateData.issued_by = adminId;
    }

    if (nextStatus === "RETURNED") {
      updateData.returned_at = new Date().toISOString();
      updateData.returned_by = adminId;
    }

    // Update borrow request
    const { data: updated, error: updateError } = await supabase
      .from("borrow_requests")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("UPDATE STATUS ERROR (update):", updateError);
      return res.status(500).json({ message: "Failed to update borrow request" });
    }

    // Audit log
    const auditAction = nextStatus === "ISSUED" ? "BORROW" : "UPDATE";
    await logAudit({
      branch_id,
      actor_id: adminId,
      actor_role: "ADMIN",
      action_type: auditAction,
      snapshot: { request_id: updated.id, status: nextStatus, items: request.items },
    });

    return res.json(updated);
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    return res.status(500).json({ message: err?.message || "Failed to update borrow request" });
  }
};