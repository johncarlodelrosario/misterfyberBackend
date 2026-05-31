import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import User from "../models/User";
import Admin from "../models/Admin";
import Application from "../models/Application";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import emailService from "../services/emailService";
import { validationResult } from "express-validator";
import mongoose from "mongoose";

interface AuthRequest extends Request {
  user?: any;
  body: any;
}

const generateToken = (id: string, role?: string): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not defined");
  }
  const payload: any = { id };
  if (role) {
    payload.role = role;
  }
  return jwt.sign(payload, jwtSecret, {
    expiresIn: (process.env.JWT_EXPIRE ||
      "30d") as jwt.SignOptions["expiresIn"],
  });
};

const sendTokenResponse = (
  user: any,
  statusCode: number,
  res: Response,
  isAdmin: boolean = false,
) => {
  const token = generateToken(user._id, isAdmin ? user.role : undefined);

  const options = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
  };

  const responseData: any = {
    success: true,
    token,
    user: {
      id: user._id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    },
  };

  if (isAdmin) {
    responseData.user.role = user.role;
  }

  res.status(statusCode).cookie("token", token, options).json(responseData);
};

// ==================== CHECK APPLICATION STATUS ====================
export const checkApplication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;

    console.log("[Auth] Checking application status:", applicationId);

    if (!applicationId || applicationId.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Invalid Application ID format",
      });
    }

    const application = await Application.findOne({ applicationId })
      .populate("planId", "name price speed description")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application ID not found. Please check your Application ID.",
      });
    }

    let alreadyRegistered = false;
    if (application.registeredUserId) {
      const existingUser = await User.findById(application.registeredUserId);
      if (existingUser && existingUser.status !== "inactive") {
        alreadyRegistered = true;
      }
    }

    let hasBill = false;
    let billInfo = null;

    if (application.billingStarted && application.billingCycleId) {
      const bill = await Billing.findOne({
        applicationId: application._id,
        status: { $in: ["sent", "overdue"] },
      }).lean();

      if (bill) {
        hasBill = true;
        billInfo = {
          invoiceNumber: bill.invoiceNumber,
          total: bill.total,
          dueDate: bill.dueDate,
          isProRated: bill.isProRated,
        };
      }
    }

    const responseData: any = {
      success: true,
      data: {
        status: application.status,
        applicationId: application.applicationId,
        email: application.email,
        firstName: application.firstName,
        lastName: application.lastName,
        phoneNumber: application.phoneNumber,
        planName: application.planId ? (application.planId as any).name : null,
        alreadyRegistered,
        billingStarted: application.billingStarted || false,
        hasBill,
        billInfo,
        createdAt: application.createdAt,
      },
    };

    if (application.status === "rejected" && application.adminNotes) {
      responseData.data.rejectionReason = application.adminNotes;
    }

    if (application.status === "approved" && application.adminNotes) {
      responseData.data.approvalNotes = application.adminNotes;
    }

    console.log("[Auth] Application status response:", {
      applicationId,
      status: application.status,
      alreadyRegistered,
      billingStarted: application.billingStarted,
    });

    res.status(200).json(responseData);
  } catch (error: any) {
    console.error("[Auth] Check application error:", error);
    next(error);
  }
};

// ==================== REGISTER WITH APPLICATION - CREATES USER ACCOUNT ====================
export const registerWithApplication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { username, email, password, applicationId } = req.body;

    console.log("[Auth] Registration attempt with application:", {
      username,
      email,
      applicationId,
    });

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found. Please check your Application ID.",
      });
    }

    if (application.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: `Application is ${application.status}. Only approved applications can create an account.`,
      });
    }

    if (application.registeredUserId) {
      const existingUser = await User.findById(application.registeredUserId);
      if (existingUser && existingUser.status !== "inactive") {
        return res.status(400).json({
          success: false,
          message:
            "An account has already been created for this application. Please login instead.",
        });
      }
    }

    if (application.email !== email) {
      return res.status(400).json({
        success: false,
        message:
          "Email does not match the application email. Please use the email you submitted in your application.",
      });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: "Username already taken. Please choose another username.",
      });
    }

    const existingBill = await Billing.findOne({
      applicationId: application._id,
      status: { $in: ["sent", "overdue"] },
    }).lean();

    const userData: any = {
      username,
      email: application.email,
      password,
      firstName: application.firstName,
      lastName: application.lastName,
      phoneNumber: application.phoneNumber,
      buildingId: application.buildingId,
      buildingName: application.buildingName,
      floor: application.floor,
      unitNumber: application.unitNumber,
      idType: application.idType,
      idNumber: application.idNumber,
      idImage: application.idImage || "",
      planId: application.planId,
      status: "active",
      applicationId: application.applicationId,
      mikrotik: {
        username: username,
        password: Math.random().toString(36).slice(-8),
        profile: (application.planId as any)?.mikrotikProfile || "default",
        ipAddress: "",
        macAddress: "",
      },
      billingInfo: {
        currentBill: existingBill?.total || 0,
        autoPay: false,
      },
    };

    const user = await User.create([userData], { session });
    const userDoc = user[0];

    await Application.updateOne(
      { _id: application._id },
      { $set: { registeredUserId: userDoc._id } },
      { session },
    );

    if (application.billingStarted && application.billingCycleId) {
      await BillingCycle.updateOne(
        { _id: application.billingCycleId },
        { $set: { userId: userDoc._id } },
        { session },
      );

      await Billing.updateMany(
        { applicationId: application._id },
        { $set: { userId: userDoc._id } },
        { session },
      );
    }

    await session.commitTransaction();

    // UPDATED: Use sendWelcomeEmail
    try {
      await emailService.sendWelcomeEmail(userDoc);
      console.log("[Auth] Welcome email sent to:", userDoc.email);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
    }

    console.log("[Auth] Registration successful for:", userDoc.email);

    sendTokenResponse(userDoc, 201, res, false);
  } catch (error: any) {
    await session.abortTransaction();
    console.error("Registration with application error:", error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} already exists. Please use a different ${field}.`,
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: Object.values(error.errors).map((err: any) => err.message),
      });
    }

    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== ADMIN REGISTRATION ====================
export const registerAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      username,
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      role,
    } = req.body;

    const existingAdmin = await Admin.findOne({
      $or: [{ email }, { username }],
    });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email or username already exists",
      });
    }

    const admin = await Admin.create({
      username,
      email,
      password,
      firstName,
      lastName,
      phoneNumber: phoneNumber || "",
      role: role || "staff",
      status: "active",
    });

    sendTokenResponse(admin, 201, res, true);
  } catch (error: any) {
    console.error("Admin registration error:", error);
    next(error);
  }
};

// ==================== REGULAR USER REGISTRATION (DIRECT) ====================
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { username, email, password, firstName, lastName, phoneNumber } =
      req.body;

    console.log("[Auth] Regular registration attempt:", { username, email });

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email or username already exists",
      });
    }

    const user = await User.create({
      username,
      email,
      password,
      firstName,
      lastName,
      phoneNumber: phoneNumber || "",
      status: "active",
    });

    console.log("[Auth] Regular registration successful for:", user.email);

    // UPDATED: Send welcome email
    try {
      await emailService.sendWelcomeEmail(user);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
    }

    sendTokenResponse(user, 201, res, false);
  } catch (error: any) {
    console.error("Registration error:", error);
    next(error);
  }
};

// ==================== CREATE INITIAL ADMIN ====================
export const createInitialAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const existingAdmin = await Admin.findOne({
      email: "admin@misterfyber.com",
    });
    if (existingAdmin) {
      return res.status(200).json({
        success: true,
        message: "Admin already exists",
        admin: {
          id: existingAdmin._id,
          email: existingAdmin.email,
          username: existingAdmin.username,
          role: existingAdmin.role,
        },
      });
    }

    const admin = await Admin.create({
      username: "superadmin",
      email: "admin@misterfyber.com",
      password: "admin123",
      firstName: "Super",
      lastName: "Admin",
      role: "super_admin",
      status: "active",
    });

    console.log("✅ Initial super_admin created successfully");
    console.log("Email: admin@misterfyber.com");
    console.log("Password: admin123");

    res.status(201).json({
      success: true,
      message: "Initial super_admin created successfully",
      admin: {
        id: admin._id,
        email: admin.email,
        username: admin.username,
        role: admin.role,
      },
    });
  } catch (error: any) {
    console.error("Create initial admin error:", error);
    next(error);
  }
};

// ==================== LOGIN ====================
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, password } = req.body;

    console.log("[Auth] Login attempt for email:", email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    let admin = await Admin.findOne({ email }).select("+password");
    if (admin) {
      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
        console.log("[Auth] Admin password mismatch for:", email);
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      if (admin.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "Account is not active. Please contact support.",
        });
      }

      admin.lastLogin = new Date();
      await admin.save();

      console.log(`✅ Admin logged in: ${admin.email} (${admin.role})`);

      return sendTokenResponse(admin, 200, res, true);
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      console.log("[Auth] User not found for email:", email);
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log("[Auth] User password mismatch for:", email);
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Account suspended. Please contact support.",
      });
    }

    if (user.status === "inactive") {
      return res.status(403).json({
        success: false,
        message: "Account inactive. Please contact support.",
      });
    }

    if (user.status === "pending") {
      return res.status(403).json({
        success: false,
        message: "Account pending approval. Please wait for admin approval.",
      });
    }

    user.lastLogin = new Date();
    await user.save();

    console.log(`✅ User logged in: ${user.email}`);

    sendTokenResponse(user, 200, res, false);
  } catch (error) {
    console.error("[Auth] Login error:", error);
    next(error);
  }
};

// ==================== LOGOUT ====================
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.cookie("token", "none", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

// ==================== GET CURRENT USER ====================
export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    const isAdmin = req.user?.role !== undefined;

    if (isAdmin) {
      const admin = await Admin.findById(userId).select("-password");
      if (!admin) {
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });
      }
      return res.status(200).json({
        success: true,
        data: {
          ...admin.toObject(),
          isAdmin: true,
        },
      });
    }

    const user = await User.findById(userId)
      .select("-password")
      .populate("planId");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        ...user.toObject(),
        isAdmin: false,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== UPDATE PASSWORD ====================
export const updatePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const isAdmin = req.user?.role !== undefined;

    if (isAdmin) {
      const admin = await Admin.findById(req.user._id).select("+password");
      if (!admin) {
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });
      }

      const isMatch = await admin.comparePassword(currentPassword);
      if (!isMatch) {
        return res
          .status(401)
          .json({ success: false, message: "Current password is incorrect" });
      }

      admin.password = newPassword;
      await admin.save();
    } else {
      const user = await User.findById(req.user._id).select("+password");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res
          .status(401)
          .json({ success: false, message: "Current password is incorrect" });
      }

      user.password = newPassword;
      await user.save();

      try {
        await emailService.sendEmail(
          user.email,
          "Password Changed Successfully",
          `<p>Your password has been changed successfully. If you did not perform this action, please contact support immediately.</p>`,
        );
      } catch (emailError) {
        console.error("Failed to send password change email:", emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ==================== FORGOT PASSWORD ====================
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with that email",
      });
    }

    const resetToken = randomBytes(20).toString("hex");

    user.resetPasswordToken = createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpire = new Date(Date.now() + 10 * 60 * 1000);

    await user.save();

    // UPDATED: Use sendPasswordReset method
    await emailService.sendPasswordReset(user, resetToken);

    res.status(200).json({
      success: true,
      message: "Password reset email sent",
    });
  } catch (error) {
    next(error);
  }
};

// ==================== RESET PASSWORD ====================
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const resetPasswordToken = createHash("sha256")
      .update(req.params.resettoken)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    sendTokenResponse(user, 200, res, false);
  } catch (error) {
    next(error);
  }
};

export default {
  register,
  registerAdmin,
  registerWithApplication,
  createInitialAdmin,
  login,
  logout,
  getMe,
  updatePassword,
  forgotPassword,
  resetPassword,
  checkApplication,
};
