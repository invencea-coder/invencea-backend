import { supabase } from "../config/supabaseClient.js";

/* ===============================
   AUTHENTICATE (SUPABASE JWT)
================================ */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    // Validate token with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Fetch app-specific user data
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, full_name, role, branch_id, branch")
      .eq("id", data.user.id)
      .single();

    if (userError || !user) {
      return res.status(401).json({ message: "User not found" });
    }

    // Attach user to request
    req.user = user;

    next();
  } catch (err) {
    console.error("AUTH ERROR:", err);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

/* ===============================
   ROLE GUARDS / HELPERS
================================ */

/**
 * Generic role-check middleware factory.
 * Usage: requireRoles('admin') or requireRoles('kiosk','faculty')
 */
export const requireRoles = (...allowedRoles) => {
  const allowedLower = (allowedRoles || []).map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    const role = (req.user?.role ?? "").toString().toLowerCase();
    if (!role) {
      return res.status(401).json({ message: "Unauthenticated" });
    }
    if (!allowedLower.includes(role)) {
      return res.status(403).json({ message: `${allowedRoles.join(", ")} only` });
    }
    next();
  };
};

// Backwards-compatible named guards:

// Only users with role = "admin" can access admin routes
export const authorizeAdmin = (req, res, next) => {
  const role = (req.user?.role ?? "").toString().toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ message: "Admins only" });
  }
  next();
};

/**
 * Kiosk guard (expanded):
 * - allows kiosk and admin (previous behavior)
 * - also allows faculty (so faculty can create/view their own borrow requests)
 *
 * Note: This intentionally accepts multiple roles. If you want a stricter name,
 * you can use requireRoles('kiosk','faculty') directly in routes instead.
 */
export const authorizeKiosk = (req, res, next) => {
  const role = (req.user?.role ?? "").toString().toLowerCase();
  if (!["kiosk", "admin", "faculty"].includes(role)) {
    return res.status(403).json({ message: "Kiosk only" });
  }
  next();
};
