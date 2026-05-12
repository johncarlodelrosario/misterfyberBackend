// routes/billingRoutes.ts - COMPLETE FIXED VERSION
import express from "express";
import { body } from "express-validator";
import {
  startBilling,
  confirmProRatedPayment,
  startMonthlyBilling,
  markBillAsPaid,
  getPendingProRatedBills,
  getPendingActivations,
  getBillingSummaryAdmin, // FIXED: Changed from getBillingSummary
  getUserCurrentBilling,
  getUserBillingHistory,
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
  submitProRatedPayment,
  submitMonthlyPayment,
  pauseBilling,
  resumeBilling,
} from "../controllers/billingController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// ==================== USER ROUTES ====================
router.get("/my-status", protect, getUserCurrentBilling);
router.get("/user/current", protect, getUserCurrentBilling);
router.get("/user/history", protect, getUserBillingHistory);
router.post("/user/submit-pro-rated", protect, submitProRatedPayment);
router.post("/user/submit-monthly", protect, submitMonthlyPayment);

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

// Billing cycles
router.get(
  "/cycles",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBillingCycles,
);

// All bills
router.get(
  "/all-bills",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBills,
);

// Billing summary - FIXED: Using correct function name
router.get(
  "/summary",
  protect,
  authorize("super_admin", "admin", "staff"),
  getBillingSummaryAdmin, // FIXED: Changed from getBillingSummary
);

// Pending pro-rated bills
router.get(
  "/pending-pro-rated",
  protect,
  authorize("super_admin", "admin", "staff"),
  getPendingProRatedBills,
);

// Pending activations
router.get(
  "/pending-activations",
  protect,
  authorize("super_admin", "admin", "staff"),
  getPendingActivations,
);

// Start billing
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

// Confirm pro-rated payment
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

// Start monthly billing
router.post(
  "/start-monthly",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  startMonthlyBilling,
);

// Mark bill as paid
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

// Stop billing (permanent cancellation)
router.post(
  "/stop",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  stopBilling,
);

// Pause billing (for vacation/temporary)
router.post(
  "/pause",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("reason").optional().isString(),
    body("pauseUntilDate").optional().isISO8601(),
  ],
  pauseBilling,
);

// Resume billing (after pause)
router.post(
  "/resume",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  resumeBilling,
);

// Disconnect/Reconnect (service suspension)
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
