import express from "express";
import { body } from "express-validator";
import {
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
} from "../controllers/authController";
import { protect } from "../middleware/auth";

const router = express.Router();

// ==================== PUBLIC REGISTRATION ROUTES ====================

// Regular user registration (direct - no application needed)
router.post(
  "/register",
  [
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
  ],
  register,
);

// Registration with application ID (for approved applications)
router.post(
  "/register-with-application",
  [
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("applicationId").notEmpty().withMessage("Application ID is required"),
  ],
  registerWithApplication,
);

// ==================== ADMIN ROUTES ====================

router.post(
  "/register-admin",
  [
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("role")
      .isIn(["super_admin", "admin", "staff"])
      .withMessage("Invalid role"),
  ],
  registerAdmin,
);

router.post("/create-initial-admin", createInitialAdmin);

// ==================== LOGIN/LOGOUT ====================

// FIXED: Accepts both email and username
router.post(
  "/login",
  [
    body("email")
      .optional()
      .isEmail()
      .withMessage("Please provide a valid email"),
    body("username").optional().notEmpty().withMessage("Username is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  login,
);

router.post("/logout", logout);

// ==================== CHECK APPLICATION STATUS ====================

router.get("/check-application/:applicationId", checkApplication);

// ==================== PROTECTED ROUTES ====================

router.get("/me", protect, getMe);

router.put(
  "/update-password",
  protect,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
  ],
  updatePassword,
);

// ==================== PASSWORD RESET ====================

router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Please provide a valid email")],
  forgotPassword,
);

router.put("/reset-password/:resettoken", resetPassword);

export default router;
