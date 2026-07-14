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
  toggleCustomerEmailAlerts,
  getCustomerEmailAlertsPreference,
} from "../controllers/adminController";
import { optionalAuth, adminMiddleware } from "../middleware/auth";

const router = express.Router();

router.use(optionalAuth);

router.get("/dashboard", getDashboardStats);
router.get("/recent-activities", getRecentActivities);

// ==================== CUSTOMER EMAIL ALERT TOGGLE ROUTES ====================
// These routes ALWAYS use the EXACT value provided by admin - NO DEFAULTS
router.put(
  "/customer-email-alerts/toggle",
  adminMiddleware,
  toggleCustomerEmailAlerts,
);
router.get(
  "/customer-email-alerts/preference",
  adminMiddleware,
  getCustomerEmailAlertsPreference,
);

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

router.get(
  "/customers-without-accounts",
  adminMiddleware,
  getCustomersWithoutAccounts,
);

router.get("/users", adminMiddleware, getAllUsers);
router.get("/users/:id", adminMiddleware, getUser);
router.put("/users/:id", adminMiddleware, updateUser);
router.delete("/users/:id", adminMiddleware, deleteUser);
router.put("/users/:id/approve", adminMiddleware, approveUser);
router.put("/users/:id/suspend", adminMiddleware, suspendUser);

router.get("/payments", adminMiddleware, getAllPayments);
router.get("/bills", adminMiddleware, getAllBills);

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
