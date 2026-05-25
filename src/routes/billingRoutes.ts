import express from "express";
import { optionalAuth, adminMiddleware } from "../middleware/auth";
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

const router = express.Router();

// ==================== USE OPTIONAL AUTH PARA WALANG "NOT AUTHORIZED" ERROR ====================
router.use(optionalAuth);

// ==================== ADMIN ROUTES (VIEW ONLY - PUBLIC, NO LOGIN NEEDED) ====================
router.get("/settings", getBillingSettings);
router.get("/cycles", getAllBillingCycles);
router.get("/all-bills", getAllBills);
router.get("/summary", getBillingSummaryAdmin);
router.get("/pending-pro-rated", getPendingProRatedBills);
router.get("/pending-activations", getPendingActivations);

// ==================== ADMIN ROUTES (NEED ADMIN ROLE FOR ACTIONS) ====================
router.put("/settings", adminMiddleware, updateBillingSettings);
router.get("/settings/admin", adminMiddleware, getBillingSettingsAdmin);
router.put("/settings/admin", adminMiddleware, updateBillingSettingsAdmin);
router.put("/mark-paid/:billId", adminMiddleware, markBillAsPaid);
router.post("/confirm-pro-rated", adminMiddleware, confirmProRatedPayment);
router.post("/start-monthly", adminMiddleware, startMonthlyBilling);
router.post("/start", adminMiddleware, startBilling);
router.post("/stop", adminMiddleware, stopBilling);
router.post("/pause", adminMiddleware, pauseBilling);
router.post("/resume", adminMiddleware, resumeBilling);
router.post("/disconnect", adminMiddleware, disconnectClient);
router.post("/reconnect", adminMiddleware, reconnectClient);
router.post("/auto-generate", adminMiddleware, autoGenerateMonthlyBills);
router.post("/auto-reminders", adminMiddleware, autoSendReminders);
router.post("/auto-suspend", adminMiddleware, autoSuspendOverdue);

// ==================== USER ROUTES (NEED AUTH FOR ACTIONS) ====================
router.get("/user/current", getUserCurrentBilling);
router.get("/user/history", getUserBillingHistory);
router.post("/user/submit-pro-rated", submitProRatedPayment);
router.post("/user/submit-monthly", submitMonthlyPayment);

export default router;
