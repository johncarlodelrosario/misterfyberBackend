import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Admin from "../models/Admin";

// Extend the Request interface properly
export interface AuthRequest extends Request {
  user?: any;
  admin?: any;
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  let token: string | undefined;

  // Check for token in headers
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }
  // Check for token in cookies
  else if (req.cookies && req.cookies.token) {
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

    // Check if it's an admin token (has role field)
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
      // Regular user (no role field in token)
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

export const adminOnly = (
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
