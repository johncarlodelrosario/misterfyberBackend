import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Admin from "../models/Admin";

export interface AuthRequest extends Request {
  user?: any;
  admin?: any;
  cookies: any;
  headers: any;
  authorization?: string;
}

// ==================== OPTIONAL AUTH ====================
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    console.log("[Auth] No token found - continuing as public user");
    req.user = null;
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

    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        req.user = {
          _id: admin._id,
          id: admin._id,
          email: admin.email,
          username: admin.username,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          status: admin.status,
        };
        console.log(`✅ Authenticated Admin: ${admin.email} (${admin.role})`);
      } else {
        console.log("[Auth] Admin not found for id:", decoded.id);
        req.user = null;
      }
    } else {
      const user = await User.findById(decoded.id);
      if (user) {
        req.user = {
          _id: user._id,
          id: user._id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: "user",
          status: user.status,
        };
        console.log(`✅ Authenticated User: ${user.email}`);
      } else {
        console.log("[Auth] User not found for id:", decoded.id);
        req.user = null;
      }
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
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    console.log("[Auth] No token found - returning 401");
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route. Please login.",
    });
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

    // Check if admin
    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (!admin) {
        console.log("[Auth] Admin not found for id:", decoded.id);
        return res
          .status(401)
          .json({ success: false, message: "Admin account not found" });
      }

      req.user = {
        _id: admin._id,
        id: admin._id,
        email: admin.email,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        status: admin.status,
      };
      console.log(`✅ Authenticated Admin: ${admin.email} (${admin.role})`);
    } else {
      // Regular user
      const user = await User.findById(decoded.id);
      if (!user) {
        console.log("[Auth] User not found for id:", decoded.id);
        return res
          .status(401)
          .json({ success: false, message: "User account not found" });
      }

      req.user = {
        _id: user._id,
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: "user",
        status: user.status,
      };
      console.log(`✅ Authenticated User: ${user.email}`);
    }

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
  console.log("[AdminMiddleware] Checking user:", req.user);

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

// ==================== ALIASES ====================
export const authMiddleware = protect;
export const adminOnly = adminMiddleware;

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
