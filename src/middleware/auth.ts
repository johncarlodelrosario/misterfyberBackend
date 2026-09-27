// middleware/auth.ts - COMPLETE FIXED WITH CACHE!

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Admin from "../models/Admin";
import NodeCache from "node-cache";

export interface AuthRequest extends Request {
  user?: any;
  admin?: any;
  cookies: any;
  headers: any;
  authorization?: string;
}

// ✅ AUTH CACHE - PARA SOBRANG BILIS!
const authCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

// ============================================================
// ✅ HELPER: Extract token from request
// ============================================================
const extractToken = (req: AuthRequest): string | undefined => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer")) {
    return authHeader.split(" ")[1];
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return undefined;
};

// ============================================================
// ✅ HELPER: Build user data object (unified shape)
// ============================================================
const buildUserData = (doc: any, type: "admin" | "user") => {
  return {
    _id: doc._id,
    id: doc._id,
    email: doc.email,
    username: doc.username,
    firstName: doc.firstName,
    lastName: doc.lastName,
    role: type === "admin" ? doc.role : "user",
    status: doc.status,
    type,
  };
};

// ==================== OPTIONAL AUTH ====================
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = extractToken(req);

  if (!token) {
    console.log("[Auth] No token found - continuing as public user");
    req.user = null;
    return next();
  }

  // ✅ CHECK CACHE MUNA!
  const cacheKey = `auth_${token}`;
  const cachedUser = authCache.get(cacheKey);
  if (cachedUser) {
    req.user = cachedUser;
    console.log(`⚡ AUTH CACHE HIT! ${(req.user as any)?.email}`);
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role?: string;
    };

    console.log("[Auth] Optional auth decoded:", {
      id: decoded.id,
      role: decoded.role,
    });

    let userData = null;

    // Try Admin first (if role exists in token)
    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        userData = buildUserData(admin, "admin");
        console.log(`✅ Authenticated Admin: ${admin.email} (${admin.role})`);
      }
    } else {
      const user = await User.findById(decoded.id);
      if (user) {
        userData = buildUserData(user, "user");
        console.log(`✅ Authenticated User: ${user.email}`);
      }
    }

    // Fallback: try both if first failed
    if (!userData) {
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        userData = buildUserData(admin, "admin");
        console.log(`✅ Authenticated Admin (fallback): ${admin.email}`);
      } else {
        const user = await User.findById(decoded.id);
        if (user) {
          userData = buildUserData(user, "user");
          console.log(`✅ Authenticated User (fallback): ${user.email}`);
        }
      }
    }

    if (userData) {
      authCache.set(cacheKey, userData, 60);
      req.user = userData;
    } else {
      console.log("[Auth] User not found for id:", decoded.id);
      req.user = null;
    }
    next();
  } catch (error: any) {
    console.log(
      "[Auth] Invalid token - continuing as public user:",
      error.message,
    );
    req.user = null;
    next();
  }
};

// ==================== REQUIRED AUTH - PROTECT ====================
export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = extractToken(req);

  if (!token) {
    console.log("[Auth] No token found - returning 401");
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route. Please login.",
    });
  }

  // ✅ CHECK CACHE MUNA!
  const cacheKey = `auth_${token}`;
  const cachedUser = authCache.get(cacheKey);
  if (cachedUser) {
    req.user = cachedUser;
    console.log(`⚡ AUTH CACHE HIT! ${(req.user as any)?.email}`);
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role?: string;
    };

    console.log("[Auth] Decoded token:", {
      id: decoded.id,
      role: decoded.role,
    });

    let userData = null;

    // Try Admin first (if role exists in token)
    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        userData = buildUserData(admin, "admin");
        console.log(`✅ Authenticated Admin: ${admin.email} (${admin.role})`);
      }
    } else {
      const user = await User.findById(decoded.id);
      if (user) {
        userData = buildUserData(user, "user");
        console.log(`✅ Authenticated User: ${user.email}`);
      }
    }

    // Fallback: try both if first failed
    if (!userData) {
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        userData = buildUserData(admin, "admin");
        console.log(`✅ Authenticated Admin (fallback): ${admin.email}`);
      } else {
        const user = await User.findById(decoded.id);
        if (user) {
          userData = buildUserData(user, "user");
          console.log(`✅ Authenticated User (fallback): ${user.email}`);
        }
      }
    }

    if (!userData) {
      console.log("[Auth] Account not found for id:", decoded.id);
      return res.status(401).json({
        success: false,
        message: "Account not found. Please login again.",
      });
    }

    // ✅ CACHE FOR 60 SECONDS
    authCache.set(cacheKey, userData, 60);
    req.user = userData;
    next();
  } catch (error: any) {
    console.error("[Auth] Verification error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Not authorized. Invalid or expired token.",
    });
  }
};

// ==================== ADMIN MIDDLEWARE ====================
export const adminMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  console.log("[AdminMiddleware] Checking user:", req.user?.email);

  if (!req.user) {
    console.log("[AdminMiddleware] No user found in request");
    return res.status(401).json({
      success: false,
      message: "Not authorized. Please login first.",
    });
  }

  const userRole = req.user.role;
  console.log("[AdminMiddleware] User role:", userRole);

  if (!userRole) {
    console.log("[AdminMiddleware] No role assigned to user");
    return res.status(403).json({
      success: false,
      message: "No role assigned. Admin access required.",
    });
  }

  const allowedRoles = ["super_admin", "admin", "staff"];
  if (!allowedRoles.includes(userRole)) {
    console.log(
      `[AdminMiddleware] Role ${userRole} not allowed. Allowed: ${allowedRoles.join(", ")}`,
    );
    return res.status(403).json({
      success: false,
      message: `Admin access required. Your role "${userRole}" is not authorized.`,
    });
  }

  console.log(`[AdminMiddleware] ✅ Authorized: ${userRole}`);
  next();
};

// ==================== SUPER ADMIN ONLY ====================
export const superAdminOnly = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Super admin access required",
    });
  }

  next();
};

// ==================== STAFF OR ADMIN ====================
export const staffOrAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  const role = req.user.role;
  if (
    !role ||
    (role !== "super_admin" && role !== "admin" && role !== "staff")
  ) {
    return res
      .status(403)
      .json({ success: false, message: "Staff or admin access required" });
  }

  next();
};

// ==================== AUTHORIZE MIDDLEWARE ====================
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    console.log(
      `🔐 Authorize - User role: ${userRole}, Allowed: [${roles.join(", ")}]`,
    );

    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "No role assigned to this user",
      });
    }

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `User role "${userRole}" is not authorized. Allowed roles: ${roles.join(", ")}`,
      });
    }

    console.log(`✅ Authorized: ${userRole}`);
    next();
  };
};

// ============================================================
// ✅ ALIASES (for backward compatibility)
// ============================================================
export const authMiddleware = protect;
export const adminOnly = adminMiddleware;
export const authenticate = protect;
export const requireAdmin = adminMiddleware;

// ============================================================
// ✅ CLEAR AUTH CACHE
// ============================================================
export const clearAuthCache = () => {
  authCache.flushAll();
  console.log("🗑️ Auth cache cleared");
};

// ============================================================
// ✅ EXPORT DEFAULT (for flexibility)
// ============================================================
export default {
  protect,
  optionalAuth,
  adminMiddleware,
  adminOnly,
  superAdminOnly,
  staffOrAdmin,
  authorize,
  authMiddleware,
  authenticate,
  requireAdmin,
  clearAuthCache,
};
