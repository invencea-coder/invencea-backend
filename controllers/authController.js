// invencea-backend/controllers/authController.js
import { supabase } from "../config/supabaseClient.js";
import jwt from "jsonwebtoken";

// Default TTL for active session in hours
const ACTIVE_SESSION_TTL_HOURS = Number(process.env.ACTIVE_SESSION_TTL_HOURS || 8);

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required" });
    }

    // ===== scan-login (email-only) =====
    if (!password) {
      const SCAN_SECRET = process.env.SCAN_SECRET || null;
      const providedSecret = req.get("x-scan-secret") || null;

      if (SCAN_SECRET && providedSecret !== SCAN_SECRET) {
        return res.status(403).json({ message: "Forbidden (invalid scan secret)" });
      }

      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id, email, role, branch, branch_id, full_name")
        .eq("email", email)
        .single();

      if (userError || !user) {
        return res.status(404).json({ message: "User not found" });
      }

      const role = (user.role || "").toString().toLowerCase();
      const allowedRoles = ["kiosk", "faculty"];
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ message: "Scan-login not allowed for this user role" });
      }

      if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not set. Cannot issue token for scan-login.");
        return res.status(500).json({ message: "Server not configured for scan-login" });
      }

      // Check active session
      const { data: activeSession } = await supabase
        .from("active_sessions")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (activeSession) {
        return res.status(409).json({
          message: "User already logged in elsewhere",
          active_user_name: user.full_name,
          active_user_email: user.email,
        });
      }

      // Create JWT token
      const payload = { sub: user.id, email: user.email, role };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });

      // Insert active session
      await supabase.from("active_sessions").insert({
        user_id: user.id,
        token,
        expires_at: new Date(Date.now() + ACTIVE_SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
      });

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          role: role,
          branch: user.branch,
          branch_id: user.branch_id,
          full_name: user.full_name,
        },
      });
    }

    // ===== normal password-based login =====
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.user || !data?.session) {
      return res.status(401).json({ message: "Invalid login credentials" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, role, branch, branch_id, full_name")
      .eq("id", data.user.id)
      .single();

    if (userError || !user) {
      console.error(userError);
      return res.status(500).json({ message: "Failed to load user profile" });
    }

    // Check active session
    const { data: activeSession } = await supabase
      .from("active_sessions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (activeSession) {
      return res.status(409).json({
        message: "User already logged in elsewhere",
        active_user_name: user.full_name,
        active_user_email: user.email,
      });
    }

    // Insert active session
    await supabase.from("active_sessions").insert({
      user_id: user.id,
      token: data.session.access_token,
      expires_at: new Date(Date.now() + ACTIVE_SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
    });

    return res.json({
      token: data.session.access_token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        branch: user.branch,
        branch_id: user.branch_id,
        full_name: user.full_name,
      },
    });
  } catch (err) {
    console.error("authController.login error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
