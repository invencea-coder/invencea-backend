// backend/controllers/inventoryController.js
import { supabase } from "../config/supabaseClient.js";

/* =====================================================
   UTILITIES
===================================================== */

/**
 * Return borrowed quantity using stored value when available,
 * otherwise derive it from total - available - unserviceable.
 * Ensures non-negative result.
 */
function getBorrowedQuantity(row) {
  if (typeof row.borrowed_quantity === "number") {
    return Math.max(0, row.borrowed_quantity);
  }

  const total = Number(row.total_quantity || 0);
  const available = Number(row.available_quantity || 0);
  const unserviceable = Number(row.unserviceable_quantity || 0);

  // derived borrowed (clamped)
  return Math.max(0, total - available - unserviceable);
}

/**
 * Compute available from canonical formula and clamp to zero.
 * available = max(total - borrowed - unserviceable, 0)
 */
function computeAvailable(total, borrowed, unserviceable) {
  total = Number(total || 0);
  borrowed = Number(borrowed || 0);
  unserviceable = Number(unserviceable || 0);
  const v = total - borrowed - unserviceable;
  return v > 0 ? v : 0;
}

/* =====================================================
   METADATA VALIDATION
===================================================== */
function validateMetadata(branch, metadata) {
  if (!metadata) return "Metadata is required";

  switch (branch) {
    case "ACEIS":
    case "ECEIS":
      if (!metadata.item_name || !metadata.item_type) {
        return `${branch} requires item_name and item_type`;
      }
      break;

    case "CPEIS":
      if (!metadata.item_name || !metadata.authors || !metadata.year) {
        return "CPEIS requires item_name, authors, and year";
      }
      break;

    default:
      return "Invalid branch";
  }

  return null;
}

/* =====================================================
   LIST INVENTORY
   (standardize borrowed & available before returning)
===================================================== */
export const listInventory = async (req, res) => {
  const { branch_id, search } = req.query;
  if (!branch_id) {
    return res.status(400).json({ message: "branch_id is required" });
  }

  const { data: branch, error: branchErr } = await supabase
    .from("branches")
    .select("name")
    .eq("id", branch_id)
    .single();

  if (branchErr || !branch) {
    return res.status(400).json({ message: "Invalid branch" });
  }

  let query = supabase.from("inventory").select("*").eq("branch_id", branch_id);

  if (search) {
    if (branch.name === "CPEIS") {
      query = query.or(
        `metadata->>authors.ilike.%${search}%,metadata->>year.ilike.%${search}%`
      );
    } else {
      query = query.ilike("item_name", `%${search}%`);
    }
  }

  query =
    branch.name === "CPEIS"
      ? query.order("metadata->>year", { ascending: false })
      : query.order("item_name", { ascending: true });

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ message: "Failed to fetch inventory" });
  }

  // Standardize values so UI always sees consistent numbers
  const standardized = (data || []).map((row) => {
    const total = Number(row.total_quantity || 0);
    const unserviceable = Number(row.unserviceable_quantity || 0);
    const borrowed = getBorrowedQuantity(row);
    const available = computeAvailable(total, borrowed, unserviceable);

    return {
      ...row,
      total_quantity: total,
      unserviceable_quantity: unserviceable,
      borrowed_quantity: borrowed,
      available_quantity: available,
    };
  });

  res.json(standardized);
};

/* =====================================================
   ADD INVENTORY (ADMIN)
===================================================== */
export const addInventory = async (req, res) => {
  const { barcode, branch_id, total_quantity, metadata } = req.body;

  const unserviceable_quantity = Number(req.body.unserviceable_quantity || 0);

  if (!barcode || !branch_id || !metadata || !(Number(total_quantity) >= 1)) {
    return res.status(400).json({ message: "Invalid input data" });
  }

  if (unserviceable_quantity < 0 || unserviceable_quantity > Number(total_quantity)) {
    return res.status(400).json({
      message: "Unserviceable quantity must be between 0 and total quantity",
    });
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("name")
    .eq("id", branch_id)
    .single();

  if (!branch) {
    return res.status(400).json({ message: "Invalid branch" });
  }

  const validationError = validateMetadata(branch.name, metadata);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const total = Number(total_quantity);
  const borrowed = 0;
  const available_quantity = computeAvailable(total, borrowed, unserviceable_quantity);

  const { data, error } = await supabase
    .from("inventory")
    .insert({
      barcode,
      branch_id,
      item_name: metadata.item_name,
      metadata,
      total_quantity: total,
      borrowed_quantity: borrowed,
      unserviceable_quantity,
      available_quantity,
      is_locked: false,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ message: "Failed to add inventory" });
  }

  await supabase.from("audit_logs").insert({
    action: "CREATE",
    inventory_id: data.id,
    branch_id,
    snapshot: {
      total_quantity: data.total_quantity,
      borrowed_quantity: data.borrowed_quantity ?? 0,
      unserviceable_quantity: data.unserviceable_quantity,
      available_quantity: data.available_quantity,
      metadata: data.metadata,
    },
  });

  res.status(201).json(data);
};

/* =====================================================
   UPDATE INVENTORY (ADMIN)
===================================================== */
export const updateInventory = async (req, res) => {
  const { id } = req.params;
  const { metadata, total_quantity, unserviceable_quantity } = req.body;

  const { data: current, error: curErr } = await supabase
    .from("inventory")
    .select("*")
    .eq("id", id)
    .single();

  if (curErr || !current) {
    return res.status(404).json({ message: "Inventory not found" });
  }

  // Use stored borrowed_quantity if present, otherwise derive
  const borrowed = getBorrowedQuantity(current);

  const newTotal = total_quantity !== undefined ? Number(total_quantity) : Number(current.total_quantity || 0);
  const newUnserviceable =
    unserviceable_quantity !== undefined
      ? Number(unserviceable_quantity)
      : Number(current.unserviceable_quantity || 0);

  if (newUnserviceable < 0) {
    return res.status(400).json({ message: "Unserviceable quantity must be >= 0" });
  }

  // total must not be less than borrowed + unserviceable (cannot make state impossible)
  if (newTotal < borrowed + newUnserviceable) {
    return res.status(400).json({
      message:
        "Total quantity cannot be less than borrowed + unserviceable. Adjust unserviceable or return items first.",
    });
  }

  // compute new available (canonical formula)
  const newAvailable = computeAvailable(newTotal, borrowed, newUnserviceable);

  const updatePayload = {
    item_name: metadata?.item_name ?? current.item_name,
    metadata: metadata ?? current.metadata,
    total_quantity: newTotal,
    unserviceable_quantity: newUnserviceable,
    available_quantity: newAvailable,
    updated_at: new Date(),
  };

  // keep borrowed_quantity unchanged (borrows/returns should update borrowed via transactions/RPC)
  if (typeof current.borrowed_quantity === "number") {
    updatePayload.borrowed_quantity = current.borrowed_quantity;
  }

  const { data, error } = await supabase
    .from("inventory")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ message: "Failed to update inventory" });
  }

  await supabase.from("audit_logs").insert({
    action: "UPDATE",
    inventory_id: id,
    branch_id: current.branch_id,
    snapshot: {
      total_quantity: data.total_quantity,
      borrowed_quantity: borrowed,
      unserviceable_quantity: data.unserviceable_quantity,
      available_quantity: data.available_quantity,
      metadata: data.metadata,
    },
  });

  res.json(data);
};

/* =====================================================
   DELETE INVENTORY (ADMIN)
===================================================== */
export const deleteInventory = async (req, res) => {
  const { id } = req.params;

  const { data: item, error } = await supabase
    .from("inventory")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !item) {
    return res.status(404).json({ message: "Inventory not found" });
  }

  const borrowed = getBorrowedQuantity(item);
  if (borrowed > 0) {
    return res.status(400).json({
      message: "Cannot delete inventory with borrowed items",
    });
  }

  await supabase.from("inventory").delete().eq("id", id);

  await supabase.from("audit_logs").insert({
    action: "DELETE",
    inventory_id: id,
    branch_id: item.branch_id,
    snapshot: {
      total_quantity: item.total_quantity,
      borrowed_quantity: 0,
      unserviceable_quantity: item.unserviceable_quantity,
      available_quantity: item.available_quantity,
      metadata: item.metadata,
    },
  });

  res.json({ message: "Inventory deleted successfully" });
};

/* =====================================================
   INVENTORY HISTORY
===================================================== */
export const getInventoryHistory = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("inventory_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({
      message: "Failed to fetch inventory history",
    });
  }

  res.json(data);
};
