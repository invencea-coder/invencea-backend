import { supabase } from "../config/supabaseClient.js";

export async function logAudit({ branch_id, actor_id, actor_role, action_type, snapshot, client_event_id }) {
  try {
    const snap = { ...snapshot, client_event_id };
    const { data, error } = await supabase
      .from("inventory_history")
      .insert([{
        inventory_id: snapshot.inventory_id || snapshot.item_id,
        actor_id,
        actor_role,
        action_type,
        snapshot: snap,
      }]);

    if (error) throw error;
    return data;
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err);
  }
}
