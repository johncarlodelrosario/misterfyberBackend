import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import User from "../models/User";
import Admin from "../models/Admin";
import Application from "../models/Application";
import emailService from "../services/emailService";
import { validationResult } from "express-validator";

interface AuthRequest extends Request {
  user?: any;
  body: any; // Add this line to explicitly include body property
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

// ==================== REGISTER WITH APPLICATION ====================

export const registerWithApplication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { username, email, password, applicationId } = req.body;

    // Find the application
    const application = await Application.findOne({ applicationId }).populate(
      "planId",
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found. Please check your Application ID.",
      });
    }

    // Check if application is approved
    if (application.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: `Application is ${application.status}. Only approved applications can create an account.`,
      });
    }

    // Check if account already created for this application
    if (application.registeredUserId) {
      const existingUser = await User.findById(application.registeredUserId);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message:
            "An account has already been created for this application. Please login instead.",
        });
      }
    }

    // Verify email matches application email
    if (application.email !== email) {
      return res.status(400).json({
        success: false,
        message:
          "Email does not match the application email. Please use the email you submitted in your application.",
      });
    }

    // Check if username already exists
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: "Username already taken. Please choose another username.",
      });
    }

    // Check if user already exists with this email
    let user = await User.findOne({ email: application.email });

    if (user) {
      // Update existing user
      user.username = username;
      user.password = password;
      user.firstName = application.firstName;
      user.lastName = application.lastName;
      user.phoneNumber = application.phoneNumber;
      user.buildingId = application.buildingId;
      user.buildingName = application.buildingName;
      user.floor = application.floor;
      user.unitNumber = application.unitNumber;
      user.idType = application.idType;
      user.idNumber = application.idNumber;
      if (application.idImage) user.idImage = application.idImage;
      user.planId = application.planId;
      user.status = "active";

      await user.save();
    } else {
      // Create new user
      user = await User.create({
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
        mikrotik: {
          username: "",
          password: "",
          profile: "",
          ipAddress: "",
          macAddress: "",
        },
        billingInfo: {
          currentBill: 0,
          autoPay: false,
        },
      });
    }

    // Link the application to the user
    application.registeredUserId = user._id;
    await application.save();

    // Set up MikroTik credentials
    if (!user.mikrotik) {
      user.mikrotik = {
        username: "",
        password: "",
        profile: "",
        ipAddress: "",
        macAddress: "",
      };
    }

    if (!user.mikrotik.username) {
      user.mikrotik.username = user.username;
      user.mikrotik.password = Math.random().toString(36).slice(-8);
      user.mikrotik.profile =
        (application.planId as any)?.mikrotikProfile || "default";
      await user.save();
    }

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user);
    } catch (error) {
      console.error("Failed to send welcome email:", error);
    }

    // SMS functionality removed

    sendTokenResponse(user, 201, res, false);
  } catch (error: any) {
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

// ==================== REGULAR USER REGISTRATION ====================

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
      phoneNumber,
      status: "pending",
    });

    sendTokenResponse(user, 201, res, false);
  } catch (error: any) {
    console.error("Registration error:", error);
    next(error);
  }
};

// ==================== CREATE INITIAL ADMIN (FIXED WITH SUPER_ADMIN) ====================

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

    // FIXED: Create as super_admin to have full access
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

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // Try to find as Admin first
    let admin = await Admin.findOne({ email }).select("+password");
    if (admin) {
      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
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

    // Then try as regular User
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
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

    sendTokenResponse(user, 200, res, false);
  } catch (error) {
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

// ==================== EXPORT ALL FUNCTIONS ====================

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
};
