// invencea-backend/controllers/authController.js
import { supabase } from "../config/supabaseClient.js";
import jwt from "jsonwebtoken";

// TTL (hours) for active session before considered stale
const ACTIVE_SESSION_TTL_HOURS = Number(process.env.ACTIVE_SESSION_TTL_HOURS || 8);

/* ---------- Helpers ---------- */
async function clearStaleSessions() {
  try {
    // remove any sessions where expires_at is in the past
    await supabase.from("active_sessions").delete().lt("expires_at", new Date().toISOString());
  } catch (err) {
    console.warn("clearStaleSessions error:", err);
  }
}

async function fetchActiveSession(userId) {
  try {
    const { data, error } = await supabase
      .from("active_sessions")
      .select("user_id, token, created_at, expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("fetchActiveSession error:", error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn("fetchActiveSession exception:", err);
    return null;
  }
}

/* ---------- Controllers ---------- */

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required" });
    }

    // clear global stale sessions first (optional but safe)
    await clearStaleSessions();

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

      // check active session for this user
      const activeSession = await fetchActiveSession(user.id);
      if (activeSession) {
        return res.status(409).json({
          message: "User already logged in elsewhere",
          active_user_name: user.full_name,
          active_user_email: user.email,
        });
      }

      if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not set. Cannot issue token for scan-login.");
        return res.status(500).json({ message: "Server not configured for scan-login" });
      }

      // create JWT token for scan-login
      const payload = { sub: user.id, email: user.email, role };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });

      // store active session with expires_at
      try {
        await supabase.from("active_sessions").insert({
          user_id: user.id,
          token,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + ACTIVE_SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
        });
      } catch (err) {
        // if insert fails with unique/duplicate error, treat as concurrent login
        const msg = err?.message || "";
        if (/duplicate|unique|violat/i.test(msg)) {
          return res.status(409).json({
            message: "User already logged in elsewhere",
            active_user_name: user.full_name,
            active_user_email: user.email,
          });
        }
        console.warn("active_sessions insert warning (scan-login):", err);
        // fall through and return token to avoid blocking due to transient DB issues
      }

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          role,
          branch: user.branch,
          branch_id: user.branch_id,
          full_name: user.full_name,
        },
      });
    }

    // ===== password-based login =====
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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

    // check active session
    const activeSession = await fetchActiveSession(user.id);
    if (activeSession) {
      return res.status(409).json({
        message: "User already logged in elsewhere",
        active_user_name: user.full_name,
        active_user_email: user.email,
      });
    }

    // insert active session
    try {
      await supabase.from("active_sessions").insert({
        user_id: user.id,
        token: data.session.access_token,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ACTIVE_SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
      });
    } catch (err) {
      const msg = err?.message || "";
      if (/duplicate|unique|violat/i.test(msg)) {
        return res.status(409).json({
          message: "User already logged in elsewhere",
          active_user_name: user.full_name,
          active_user_email: user.email,
        });
      }
      console.warn("active_sessions insert warning (password-login):", err);
      // fall through and still return token to avoid blocking due to transient DB issues
    }

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

/* ---------- Logout endpoint ---------- */
export const logout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const userId = req.body?.user_id;

    if (!token && !userId) {
      return res.status(400).json({ message: "Missing token or user_id" });
    }

    // Delete the session row(s)
    const query = supabase.from("active_sessions").delete();
    if (token) query.eq("token", token);
    if (userId) query.eq("user_id", userId);

    await query;

    return res.json({ success: true });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

