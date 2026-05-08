// routes/billingRoutes.ts - COMPLETE FIXED with new routes
import express from "express";
import { body } from "express-validator";
import {
  startBilling,
  confirmProRatedPayment,
  startMonthlyBilling,
  markBillAsPaid,
  getPendingProRatedBills,
  getPendingActivations,
  getBillingSummary,
  getUserCurrentBilling,
  getAllBillingCycles,
  getAllBills,
  stopBilling,
  reconnectClient,
  disconnectClient,
  autoGenerateMonthlyBills,
  autoSendReminders,
  autoSuspendOverdue,
  getBillingSettings,
  updateBillingSettings,
} from "../controllers/billingController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// ==================== USER ROUTES ====================
router.get("/my-status", protect, getUserCurrentBilling);
router.get("/user/current", protect, getUserCurrentBilling);

// ==================== ADMIN ROUTES ====================

// Billing Settings
router.get(
  "/settings",
  protect,
  authorize("super_admin", "admin", "staff"),
  getBillingSettings,
);
router.put(
  "/settings",
  protect,
  authorize("super_admin", "admin", "staff"),
  updateBillingSettings,
);

// Billing cycles - GET /api/billing/cycles
router.get(
  "/cycles",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBillingCycles,
);

// All bills - GET /api/billing/all-bills
router.get(
  "/all-bills",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBills,
);

// Billing summary - GET /api/billing/summary
router.get(
  "/summary",
  protect,
  authorize("super_admin", "admin", "staff"),
  getBillingSummary,
);

// Pending pro-rated bills - GET /api/billing/pending-pro-rated
router.get(
  "/pending-pro-rated",
  protect,
  authorize("super_admin", "admin", "staff"),
  getPendingProRatedBills,
);

// Pending activations (pro-rated paid, waiting for admin to start monthly billing)
router.get(
  "/pending-activations",
  protect,
  authorize("super_admin", "admin", "staff"),
  getPendingActivations,
);

// Start billing (with pro-rated calculation) - POST /api/billing/start
router.post(
  "/start",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("startDate").optional().isISO8601(),
    body("customAmount").optional().isNumeric(),
  ],
  startBilling,
);

// Confirm pro-rated payment (activate service) - POST /api/billing/confirm-pro-rated
router.post(
  "/confirm-pro-rated",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("paymentDetails").optional().isObject(),
  ],
  confirmProRatedPayment,
);

// Start monthly billing (admin action after pro-rated payment) - POST /api/billing/start-monthly
router.post(
  "/start-monthly",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  startMonthlyBilling,
);

// Mark any bill as paid (admin override) - PUT /api/billing/mark-paid/:billId
router.put(
  "/mark-paid/:billId",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("referenceNumber").optional().isString(),
    body("notes").optional().isString(),
  ],
  markBillAsPaid,
);

// Stop billing - POST /api/billing/stop
router.post(
  "/stop",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  stopBilling,
);

// Disconnect/Reconnect
router.post(
  "/disconnect",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  disconnectClient,
);

router.post(
  "/reconnect",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  reconnectClient,
);

// ==================== CRON JOB ROUTES (Internal) ====================
router.post("/auto-generate", autoGenerateMonthlyBills);
router.post("/auto-reminders", autoSendReminders);
router.post("/auto-suspend", autoSuspendOverdue);

export default router;
