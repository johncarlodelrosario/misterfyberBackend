// routes/adminRoutes.ts - COMPLETE UPDATED (REMOVED EMAIL TOGGLE)
import express from "express";
import { body } from "express-validator";
import {
  getDashboardStats,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  approveUser,
  suspendUser,
  getAllPayments,
  getAllBills,
  generateReport,
  getRecentActivities,
  createManualCustomer,
  getCustomersWithoutAccounts,
} from "../controllers/adminController";
import { optionalAuth, adminMiddleware } from "../middleware/auth";

const router = express.Router();

// Use optional auth para hindi mag-error kahit walang login
router.use(optionalAuth);

// Dashboard routes (viewable kahit walang login)
router.get("/dashboard", getDashboardStats);
router.get("/recent-activities", getRecentActivities);

// Manual Customer Creation - need admin role
router.post(
  "/manual-customer",
  adminMiddleware,
  [
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
    body("planId").notEmpty().withMessage("Plan selection is required"),
  ],
  createManualCustomer,
);

// Get customers without accounts - need admin role
router.get(
  "/customers-without-accounts",
  adminMiddleware,
  getCustomersWithoutAccounts,
);

// User management - need admin role
router.get("/users", adminMiddleware, getAllUsers);
router.get("/users/:id", adminMiddleware, getUser);
router.put("/users/:id", adminMiddleware, updateUser);
router.delete("/users/:id", adminMiddleware, deleteUser);
router.put("/users/:id/approve", adminMiddleware, approveUser);
router.put("/users/:id/suspend", adminMiddleware, suspendUser);

// Payment and billing - need admin role
router.get("/payments", adminMiddleware, getAllPayments);
router.get("/bills", adminMiddleware, getAllBills);

// Reports - need admin role
router.post(
  "/reports",
  adminMiddleware,
  [
    body("type")
      .isIn(["revenue", "users", "plans", "billing"])
      .withMessage("Please select a valid report type"),
    body("startDate").isISO8601().withMessage("Valid start date is required"),
    body("endDate").isISO8601().withMessage("Valid end date is required"),
    body("format").optional().isIn(["json", "csv", "pdf"]),
  ],
  generateReport,
);

export default router;
