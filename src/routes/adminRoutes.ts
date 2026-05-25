// routes/adminRoutes.ts - COMPLETE FILE
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
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// All admin routes require authentication and admin role
router.use(protect);
router.use(authorize("super_admin", "admin", "staff"));

// Dashboard routes
router.get("/dashboard", getDashboardStats);
router.get("/recent-activities", getRecentActivities);

// Manual Customer Creation
router.post(
  "/manual-customer",
  [
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
    body("planId").notEmpty().withMessage("Plan selection is required"),
  ],
  createManualCustomer,
);
router.get("/customers-without-accounts", getCustomersWithoutAccounts);

// User management
router.get("/users", getAllUsers);
router.get("/users/:id", getUser);
router.put("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);
router.put("/users/:id/approve", approveUser);
router.put("/users/:id/suspend", suspendUser);

// Payment and billing
router.get("/payments", getAllPayments);
router.get("/bills", getAllBills);

// Reports
router.post(
  "/reports",
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
