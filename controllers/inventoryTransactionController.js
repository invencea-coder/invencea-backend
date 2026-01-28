// backend/controllers/inventoryTransactionController.js
import { supabase } from "../config/supabaseClient.js";

/* =====================================================
   BORROW INVENTORY
===================================================== */
export const borrowInventory = async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ message: "Invalid quantity" });
  }

  const { data, error } = await supabase.rpc("borrow_inventory", {
    p_inventory_id: id,
    p_quantity: quantity,
  });

  if (error || !data) {
    return res.status(400).json({ message: error?.message });
  }

  await supabase.from("inventory_transactions").insert({
    inventory_id: id,
    action: "BORROW",
    quantity,
  });

  await supabase.from("audit_logs").insert({
    action: "BORROW",
    inventory_id: id,
    branch_id: data.branch_id,
    snapshot: {
      total_quantity: data.total_quantity,
      borrowed_quantity:
        data.total_quantity -
        data.available_quantity -
        data.unserviceable_quantity,
      unserviceable_quantity: data.unserviceable_quantity,
      available_quantity: data.available_quantity,
      metadata: data.metadata,
    },
  });

  res.json({
    message: "Item borrowed successfully",
    available_quantity: data.available_quantity,
  });
};

/* =====================================================
   RETURN INVENTORY
===================================================== */
export const returnInventory = async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ message: "Invalid quantity" });
  }

  const { data, error } = await supabase.rpc("return_inventory", {
    p_inventory_id: id,
    p_quantity: quantity,
  });

  if (error || !data) {
    return res.status(400).json({ message: error?.message });
  }

  await supabase.from("inventory_transactions").insert({
    inventory_id: id,
    action: "RETURN",
    quantity,
  });

  await supabase.from("audit_logs").insert({
    action: "RETURN",
    inventory_id: id,
    branch_id: data.branch_id,
    snapshot: {
      total_quantity: data.total_quantity,
      borrowed_quantity:
        data.total_quantity -
        data.available_quantity -
        data.unserviceable_quantity,
      unserviceable_quantity: data.unserviceable_quantity,
      available_quantity: data.available_quantity,
      metadata: data.metadata,
    },
  });

  res.json({
    message: "Item returned successfully",
    available_quantity: data.available_quantity,
  });
};
