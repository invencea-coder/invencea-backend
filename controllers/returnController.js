import { supabase } from "../config/supabaseClient.js";

/* helpers */
const parseItems = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === "string") {
    try { return JSON.parse(items); } catch { return []; }
  }
  return [];
};

const cleanBarcode = (b) => {
  if (!b && b !== 0) return "";
  let s = String(b);
  s = s.replace(/[\r\n]+/g, "").trim();
  s = s.replace(/^barcode[:=]\s*/i, "");
  return s;
};

export const getReturnOptions = async (req, res) => {
  try {
    const rawBarcode = req.query?.barcode;
    const barcode = cleanBarcode(rawBarcode);
    const admin = req.user;

    if (!barcode || !admin?.branch_id) {
      return res.status(400).json({ message: "barcode and valid admin session required" });
    }

    // inventory lookup exact then partial
    let { data: inventory, error: invErr } = await supabase
      .from("inventory")
      .select("id, barcode, item_name, metadata, branch_id")
      .eq("barcode", barcode)
      .eq("branch_id", admin.branch_id)
      .maybeSingle();

    if (invErr) throw invErr;

    if (!inventory) {
      const { data: partials, error: partialErr } = await supabase
        .from("inventory")
        .select("id, barcode, item_name, metadata, branch_id")
        .ilike("barcode", `%${barcode}%`)
        .eq("branch_id", admin.branch_id)
        .limit(1);

      if (partialErr) throw partialErr;
      inventory = (partials && partials[0]) || null;
    }

    if (!inventory) {
      return res.status(404).json({ message: "Item not found for this barcode" });
    }

    // ONLY ISSUED requests are returnable
    const { data: rows, error: reqErr } = await supabase
      .from("borrow_requests")
      .select("id, status, items, requester_name, requester_id, created_at, issued_at")
      .eq("branch_id", admin.branch_id)
      .eq("status", "ISSUED");

    if (reqErr) throw reqErr;

    const options = [];
    for (const r of rows || []) {
      const items = parseItems(r.items);
      if (!Array.isArray(items)) continue;

      // compute remaining: quantity - returned_quantity
      const it = items.find(x => String(x.item_id) === String(inventory.id) && (Number(x.quantity || 0) - Number(x.returned_quantity || 0)) > 0);
      if (it) {
        const remaining = Math.max(0, Number(it.quantity || 0) - Number(it.returned_quantity || 0));
        options.push({
          borrow_request_id: r.id,
          requester_name: r.requester_name,
          requester_id: r.requester_id,
          issued_quantity: remaining, // remaining available-to-return
          request_status: r.status,
          requested_at: r.created_at,
          issued_at: r.issued_at || r.created_at,
        });
      }
    }

    if (!options.length) {
      return res.status(404).json({ message: "No ISSUED borrow requests found for this item" });
    }

    options.sort((a,b) => new Date(a.issued_at) - new Date(b.issued_at));
    return res.json({
      inventory: { id: inventory.id, barcode: inventory.barcode, item_name: inventory.item_name },
      options,
    });
  } catch (err) {
    console.error("GET RETURN OPTIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch return options" });
  }
};

export const returnByBarcode = async (req, res) => {
  try {
    const rawBarcode = req.body?.barcode;
    const barcode = cleanBarcode(rawBarcode);
    const admin = req.user;

    if (!barcode || !admin?.branch_id)
      return res.status(400).json({ message: "barcode and session required" });

    const qtyToReturn = Number(req.body?.quantity || 0);
    if (!Number.isInteger(qtyToReturn) || qtyToReturn <= 0)
      return res.status(400).json({ message: "Quantity must be positive integer" });

    // optional client-provided fields for offline sync
    const clientEventId =
       req.body?.client_event_id ||
          `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnedAt =
       req.body?.client_returned_at ||
       req.body?.returned_at ||
       new Date().toISOString();

    // 1) get inventory (exact then fallback)
    let { data: inventory, error: invErr } = await supabase
      .from("inventory")
      .select("id, barcode, branch_id, borrowed_quantity, unserviceable_quantity, total_quantity")
      .eq("barcode", barcode)
      .eq("branch_id", admin.branch_id)
      .maybeSingle();

    if (invErr) throw invErr;

    if (!inventory) {
      const { data: partials, error: partialErr } = await supabase
        .from("inventory")
        .select("id, barcode, branch_id, borrowed_quantity, unserviceable_quantity, total_quantity")
        .ilike("barcode", `%${barcode}%`)
        .eq("branch_id", admin.branch_id)
        .limit(1);

      if (partialErr) throw partialErr;
      inventory = (partials && partials[0]) || null;
    }

    if (!inventory)
      return res.status(404).json({ message: "Item not found for this barcode" });

    // 2) get issued borrow requests for this item
    const { data: rows, error: reqErr } = await supabase
      .from("borrow_requests")
      .select("id, status, items, requester_name, requester_id, created_at, issued_at")
      .eq("branch_id", admin.branch_id)
      .eq("status", "ISSUED");

    if (reqErr) throw reqErr;

    const matches = [];
    for (const r of rows || []) {
      const items = parseItems(r.items);
      if (!Array.isArray(items)) continue;
      // compute remaining for each item element
      const it = items.find(x => String(x.item_id) === String(inventory.id) && (Number(x.quantity || 0) - Number(x.returned_quantity || 0)) > 0);
      if (it) {
        const remaining = Math.max(0, Number(it.quantity || 0) - Number(it.returned_quantity || 0));
        // store remaining on the chosen item so downstream code uses it
        matches.push({ request: r, item: { ...it, remaining } });
      }
    }

    if (!matches.length)
      return res.status(400).json({ message: "No ISSUED borrow request found for this item" });

    // 3) choose borrow request to return
    let chosen = null;
    const requestedId = req.body?.borrow_request_id;
    if (requestedId) {
      chosen = matches.find(m => String(m.request.id) === String(requestedId));
      if (!chosen)
        return res.status(404).json({ message: "Borrow request not found for this item" });
    } else {
      matches.sort(
        (a, b) =>
          new Date(a.request.issued_at || a.request.created_at) - new Date(b.request.issued_at || b.request.created_at)
      );
      chosen = matches[0];
    }

    // remaining available-to-return on this chosen item
    const issuedQty = Number(chosen.item.remaining || 0);
    if (qtyToReturn > issuedQty)
      return res.status(400).json({
        message: `Return quantity (${qtyToReturn}) exceeds remaining issued (${issuedQty})`,
      });

    // 4) Call DB function (RPC) to perform idempotent, atomic return processing
    const rpcArgs = {
      p_client_event_id: clientEventId,
      p_borrow_request_id: chosen.request.id,
      p_inventory_id: inventory.id,
      p_quantity: qtyToReturn,
      p_returned_at: returnedAt,
      p_branch_id: admin.branch_id,
      p_actor_id: admin.id,
    };

    const { data: rpcResult, error: rpcErr } = await supabase.rpc("process_return_event", rpcArgs);

    if (rpcErr) {
      console.error("PROCESS_RETURN_EVENT RPC ERROR:", rpcErr);
      // If the RPC error contains Postgres details, include them in the message for debugging
      const msg = rpcErr?.message || rpcErr?.details || "Failed to process return (rpc)";
      return res.status(500).json({ message: msg });
    }

    const result = rpcResult;

    if (result?.status === "already_processed") {
      // try to fetch the latest row for the request so UI can show current quantities
      const { data: existingReq, error: existErr } = await supabase
        .from("borrow_requests")
        .select("*")
        .eq("id", chosen.request.id)
        .maybeSingle();

      if (existErr) {
        console.error("Failed to fetch existing borrow_request after already_processed:", existErr);
        return res.json({ message: "Return already processed (idempotent)", request: null });
      }

      return res.json({ message: "Return already processed (idempotent)", request: existingReq });
    }

    // If RPC succeeded, fetch the updated borrow_request row
    const { data: updatedRequest, error: fetchReqErr } = await supabase
      .from("borrow_requests")
      .select("*")
      .eq("id", chosen.request.id)
      .maybeSingle();

    if (fetchReqErr) {
      console.error("Failed to fetch updated borrow_request after RPC:", fetchReqErr);
      // still respond success but without updated request
      return res.json({ message: "Return processed successfully", request: null, processed_at: result?.processed_at || new Date().toISOString() });
    }

    // Return the updated full borrow_request object so UI can update immediately (and partial returns remain visible)
    return res.json({ message: "Return processed successfully", request: updatedRequest, processed_at: result?.processed_at || new Date().toISOString() });
  } catch (err) {
    console.error("RETURN ERROR:", err);
    return res.status(500).json({ message: "Return failed" });
  }
};
