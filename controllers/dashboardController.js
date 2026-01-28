// backend/controllers/dashboardController.js
import { supabase } from "../config/supabaseClient.js";

export const getDashboardData = async (req, res) => {
  try {
    const branch_id = req.user?.branch_id;

    if (!branch_id) {
      return res
        .status(400)
        .json({ message: "branch_id missing from user context" });
    }

    const ACTIVITY_LIMIT = 5;
    const PENDING_LIST_LIMIT = 6;

    const [
      activityResp,
      latestItemResp,
      pendingCountResp,
      pendingListResp,
    ] = await Promise.all([
      // 1️⃣ Recent activities
      supabase
        .from("audit_logs")
        .select("id, action, branch_id, created_at, snapshot")
        .eq("branch_id", branch_id)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LIMIT),

      // 2️⃣ Latest inventory item
      supabase
        .from("inventory")
        .select(
          "id, barcode, item_name, metadata, total_quantity, unserviceable_quantity, available_quantity, created_at"
        )
        .eq("branch_id", branch_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 3️⃣ Pending borrow count
      supabase
        .from("borrow_requests")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branch_id)
        .eq("status", "PENDING"),

      // 4️⃣ Pending borrow list
      supabase
        .from("borrow_requests")
        .select("id, requester_name, requester_id, created_at, items")
        .eq("branch_id", branch_id)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .limit(PENDING_LIST_LIMIT),
    ]);

    // ❌ Stop immediately if any query failed
    if (activityResp.error) throw activityResp.error;
    if (latestItemResp.error) throw latestItemResp.error;
    if (pendingCountResp.error) throw pendingCountResp.error;
    if (pendingListResp.error) throw pendingListResp.error;

    res.json({
      activities: (activityResp.data || []).map((a) => ({
        id: a.id,
        action: a.action,
        created_at: a.created_at,
        snapshot: a.snapshot,
      })),

      latestItem: latestItemResp.data ?? null,

      pendingBorrowCount: pendingCountResp.count || 0,

      pendingBorrows: (pendingListResp.data || []).map((p) => ({
        id: p.id,
        requester_name: p.requester_name,
        requester_id: p.requester_id,
        created_at: p.created_at,
        items: p.items,
      })),

      current_user: {
        id: req.user.id,
        full_name: req.user.full_name,
        role: req.user.role,
      },
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ message: "Failed to load dashboard data" });
  }
};
