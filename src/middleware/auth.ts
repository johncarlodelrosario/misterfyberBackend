// middleware/auth.ts - COMPLETE FIXED FILE
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Admin from "../models/Admin";

interface AuthRequest extends Request {
  user?: any;
  admin?: any;
  headers: any;
  method: string;
  url: string;
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role?: string;
    };

    // Check if it's an admin token (has role field)
    if (decoded.role) {
      const admin = await Admin.findById(decoded.id);
      if (!admin) {
        return res
          .status(401)
          .json({ success: false, message: "Admin not found" });
      }
      req.user = admin;
      req.admin = admin;
      console.log(`✅ Authenticated: ${admin.email} (${admin.role})`);
    } else {
      // Regular user (no role field in token)
      const user = await User.findById(decoded.id);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, message: "User not found" });
      }
      req.user = user;
      console.log(`✅ Authenticated: ${user.email} (user)`);
    }

    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    console.log(`🔐 Authorize - User role: ${userRole}`);
    console.log(`🔐 Authorize - Allowed roles: [${roles.join(", ")}]`);

    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "No role assigned to this user",
      });
    }

    // Check if user role is in allowed roles
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `User role "${userRole}" is not authorized. Allowed roles: ${roles.join(", ")}`,
      });
    }

    console.log(`✅ Authorized: ${userRole} -> ${req.method} ${req.url}`);
    next();
  };
};

export const adminOnly = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authorized" });
  }

  if (
    !req.user.role ||
    (req.user.role !== "super_admin" &&
      req.user.role !== "admin" &&
      req.user.role !== "staff")
  ) {
    return res.status(403).json({ message: "Admin access required" });
  }

  next();
};

export const staffOrAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const role = req.user.role;
  if (
    !role ||
    (role !== "super_admin" && role !== "admin" && role !== "staff")
  ) {
    return res.status(403).json({ message: "Staff or admin access required" });
  }

  next();
};
