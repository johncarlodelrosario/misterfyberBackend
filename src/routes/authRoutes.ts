// routes/authRoutes.ts - COMPLETE WITH REGISTER-WITH-APPLICATION
import express from "express";
import { body } from "express-validator";
import {
  register,
  login,
  logout,
  getMe,
  updatePassword,
  forgotPassword,
  resetPassword,
  registerAdmin,
  createInitialAdmin,
  registerWithApplication,
} from "../controllers/authController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// Public routes
router.post("/create-initial-admin", createInitialAdmin);

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
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
  ],
  register,
);

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

router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  login,
);

router.post("/logout", logout);

router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Please provide a valid email")],
  forgotPassword,
);

router.put(
  "/reset-password/:resettoken",
  [
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  resetPassword,
);

// Protected routes
router.use(protect);
router.get("/me", getMe);
router.put(
  "/update-password",
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

// Admin only routes
router.post(
  "/register-admin",
  authorize("super_admin"),
  [
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("role")
      .optional()
      .isIn(["super_admin", "admin", "staff"])
      .withMessage("Invalid role"),
  ],
  registerAdmin,
);

export default router;
