// routes/billingRoutes.ts - COMPLETE WORKING VERSION
import express from "express";
import {
  startBilling,
  stopBilling,
  pauseBilling,
  resumeBilling,
  disconnectClient,
  reconnectClient,
  getBillingSettings,
  updateBillingSettings,
  getBillingSettingsAdmin,
  updateBillingSettingsAdmin,
  getBillingSummaryAdmin,
  getAllBillingCycles,
  getAllBills,
  markBillAsPaid,
  getPendingProRatedBills,
  getPendingActivations,
  confirmProRatedPayment,
  startMonthlyBilling,
  autoGenerateMonthlyBills,
  autoSendReminders,
  autoSuspendOverdue,
  getUserCurrentBilling,
  getUserBillingHistory,
  submitProRatedPayment,
  submitMonthlyPayment,
} from "../controllers/billingController";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const router = express.Router();

// ==================== ADMIN ROUTES ====================

// Settings
router.get("/settings", authMiddleware, getBillingSettings);
router.put("/settings", authMiddleware, adminMiddleware, updateBillingSettings);
router.get(
  "/settings/admin",
  authMiddleware,
  adminMiddleware,
  getBillingSettingsAdmin,
);
router.put(
  "/settings/admin",
  authMiddleware,
  adminMiddleware,
  updateBillingSettingsAdmin,
);

// Summary
router.get("/summary", authMiddleware, adminMiddleware, getBillingSummaryAdmin);

// Billing Cycles
router.get("/cycles", authMiddleware, adminMiddleware, getAllBillingCycles);

// Bills
router.get("/all-bills", authMiddleware, adminMiddleware, getAllBills);
router.put(
  "/mark-paid/:billId",
  authMiddleware,
  adminMiddleware,
  markBillAsPaid,
);

// Pending Actions
router.get(
  "/pending-pro-rated",
  authMiddleware,
  adminMiddleware,
  getPendingProRatedBills,
);
router.get(
  "/pending-activations",
  authMiddleware,
  adminMiddleware,
  getPendingActivations,
);
router.post(
  "/confirm-pro-rated",
  authMiddleware,
  adminMiddleware,
  confirmProRatedPayment,
);
router.post(
  "/start-monthly",
  authMiddleware,
  adminMiddleware,
  startMonthlyBilling,
);

// Billing Actions
router.post("/start", authMiddleware, adminMiddleware, startBilling);
router.post("/stop", authMiddleware, adminMiddleware, stopBilling);
router.post("/pause", authMiddleware, adminMiddleware, pauseBilling);
router.post("/resume", authMiddleware, adminMiddleware, resumeBilling);
router.post("/disconnect", authMiddleware, adminMiddleware, disconnectClient);
router.post("/reconnect", authMiddleware, adminMiddleware, reconnectClient);

// Auto Jobs (for cron)
router.post(
  "/auto-generate",
  authMiddleware,
  adminMiddleware,
  autoGenerateMonthlyBills,
);
router.post(
  "/auto-reminders",
  authMiddleware,
  adminMiddleware,
  autoSendReminders,
);
router.post(
  "/auto-suspend",
  authMiddleware,
  adminMiddleware,
  autoSuspendOverdue,
);

// ==================== USER ROUTES ====================
router.get("/user/current", authMiddleware, getUserCurrentBilling);
router.get("/user/history", authMiddleware, getUserBillingHistory);
router.post("/user/submit-pro-rated", authMiddleware, submitProRatedPayment);
router.post("/user/submit-monthly", authMiddleware, submitMonthlyPayment);

export default router;
