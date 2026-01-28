import { supabase } from "../config/supabaseClient.js";

export const listAuditLogs = async (req, res) => {
  try {
    const { branch_id, role } = req.user;

    // Only admins can access
    // Only admins can access
if (role?.toLowerCase() !== "admin") {
  return res.status(403).json({ message: "Forbidden" });
}


    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("branch_id", branch_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("AUDIT LIST ERROR:", err);
    res.status(500).json({ message: "Failed to fetch audit logs" });
  }
};


