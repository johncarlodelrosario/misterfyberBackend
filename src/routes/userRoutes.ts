// routes/userRoutes.ts - COMPLETE FIXED WITH ALL BILLING ROUTES
import express from "express";
import { body } from "express-validator";
import {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  changePassword,
  changePlan,
  getUsage,
  getBillingSummary,
  requestDeletion,
  getConnectionInfo,
  updateNotificationPreferences,
  getInvoice,
  downloadInvoice,
  getSupportTickets,
  createSupportTicket,
  getUserBillingCycle,
  requestPlanChange,
  getCurrentBill,
  getBillingHistory,
  getUserDashboard,
} from "../controllers/userController";
import { protect } from "../middleware/auth";
import { uploadIdCard } from "../middleware/upload";

const router = express.Router();

// All user routes require authentication
router.use(protect);

// ==================== DASHBOARD ====================
router.get("/dashboard", getUserDashboard);

// ==================== PROFILE ====================
router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.post(
  "/profile/picture",
  uploadIdCard.single("profilePicture"),
  uploadProfilePicture,
);

// ==================== PASSWORD ====================
router.put(
  "/change-password",
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
  ],
  changePassword,
);

// ==================== PLAN ====================
router.put(
  "/change-plan",
  [body("planId").isMongoId().withMessage("Valid plan ID is required")],
  changePlan,
);
router.post(
  "/request-plan-change",
  [
    body("newPlanId").isMongoId().withMessage("Valid plan ID is required"),
    body("effectiveDate")
      .optional()
      .isISO8601()
      .withMessage("Valid date format"),
  ],
  requestPlanChange,
);

// ==================== BILLING ROUTES ====================
router.get("/billing/current", getCurrentBill);
router.get("/billing/history", getBillingHistory);
router.get("/billing-cycle", getUserBillingCycle);
router.get("/billing-summary", getBillingSummary);

// ==================== USAGE ====================
router.get("/usage", getUsage);

// ==================== INVOICES ====================
router.get("/invoice/:invoiceId", getInvoice);
router.get("/invoice/:invoiceId/download", downloadInvoice);

// ==================== CONNECTION INFO ====================
router.get("/connection-info", getConnectionInfo);

// ==================== NOTIFICATION PREFERENCES ====================
router.put("/notification-preferences", updateNotificationPreferences);

// ==================== SUPPORT TICKETS ====================
router.get("/support-tickets", getSupportTickets);
router.post(
  "/support-tickets",
  [
    body("subject").notEmpty().withMessage("Subject is required"),
    body("category")
      .isIn(["billing", "technical", "account", "other"])
      .withMessage("Valid category is required"),
    body("message").notEmpty().withMessage("Message is required"),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
  ],
  createSupportTicket,
);

// ==================== ACCOUNT DELETION ====================
router.post(
  "/request-deletion",
  [body("reason").optional().isString()],
  requestDeletion,
);

export default router;
