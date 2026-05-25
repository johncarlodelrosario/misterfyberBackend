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

// ==================== OPTIONAL AUTH - HINDI MAG EERROR KAHIT WALANG TOKEN ====================
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

    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        req.user = admin;
        console.log(`✅ Authenticated Admin: ${admin.email}`);
      } else {
        req.user = null;
      }
    } else {
      const user = await User.findById(decoded.id);
      if (user) {
        req.user = user;
        console.log(`✅ Authenticated User: ${user.email}`);
      } else {
        req.user = null;
      }
    }
    next();
  } catch (error: any) {
    console.log("[Auth] Invalid token - continuing as public user");
    req.user = null;
    next();
  }
};

// ==================== REQUIRED AUTH - MAG EERROR KUNG WALANG TOKEN ====================
export const authMiddleware = async (
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
    console.log("[Auth] No token found");
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

    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (!admin) {
        return res
          .status(401)
          .json({ success: false, message: "Admin not found" });
      }
      req.user = admin;
      console.log(`✅ Authenticated Admin: ${admin.email} (${admin.role})`);
    } else {
      const user = await User.findById(decoded.id);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, message: "User not found" });
      }
      req.user = user;
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

export const adminMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  if (
    !req.user.role ||
    (req.user.role !== "super_admin" && req.user.role !== "admin")
  ) {
    return res
      .status(403)
      .json({ success: false, message: "Admin access required" });
  }

  next();
};

export const protect = authMiddleware;

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

export const adminOnly = adminMiddleware;

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
