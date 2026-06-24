import express from "express";
import { optionalAuth, adminMiddleware } from "../middleware/auth";
import {
  startBilling,
  stopBilling,
  pauseBilling,
  resumeBilling,
  disconnectClient,
  reconnectClient,
  deleteBillingCycle,
  getBillingSettings,
  updateBillingSettings,
  getBillingSettingsAdmin,
  updateBillingSettingsAdmin,
  getBillingSummaryAdmin,
  getAllBillingCycles,
  getAllBills,
  markBillAsPaid,
  markInstallationBillAsPaid,
  getPendingProRatedBills,
  getPendingInstallationBills,
  getPendingActivations,
  confirmProRatedPayment,
  startMonthlyBilling,
  autoGenerateMonthlyBills,
  autoSendReminders,
  autoSuspendOverdue,
  getApplicationCurrentBilling,
  getApplicationBillingHistory,
  submitProRatedPayment,
  submitInstallationPayment,
  submitMonthlyPayment,
  getApplicationBillingStatus,
  recoverMissingBills,
  initializeBackdatedBilling,
  getUnpaidBillsReport,
  manuallyGenerateBillsForMonth,
  getLocationEmails,
  testLocationEmail,
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
router.get("/pending-installation", getPendingInstallationBills);
router.get("/pending-activations", getPendingActivations);
router.get("/unpaid-bills-report", adminMiddleware, getUnpaidBillsReport);

// ==================== LOCATION EMAIL ROUTES ====================
router.get("/location/emails", adminMiddleware, getLocationEmails);
router.post("/location/test", adminMiddleware, testLocationEmail);

// ==================== ADMIN ROUTES (NEED ADMIN ROLE FOR ACTIONS) ====================
router.put("/settings", adminMiddleware, updateBillingSettings);
router.get("/settings/admin", adminMiddleware, getBillingSettingsAdmin);
router.put("/settings/admin", adminMiddleware, updateBillingSettingsAdmin);
router.put("/mark-paid/:billId", adminMiddleware, markBillAsPaid);
router.put(
  "/mark-installation-paid/:billId",
  adminMiddleware,
  markInstallationBillAsPaid,
);
router.post("/confirm-pro-rated", adminMiddleware, confirmProRatedPayment);
router.post("/start-monthly", adminMiddleware, startMonthlyBilling);
router.post("/start", adminMiddleware, startBilling);
router.post("/stop", adminMiddleware, stopBilling);
router.post("/pause", adminMiddleware, pauseBilling);
router.post("/resume", adminMiddleware, resumeBilling);
router.post("/disconnect", adminMiddleware, disconnectClient);
router.post("/reconnect", adminMiddleware, reconnectClient);
router.delete("/delete-cycle", adminMiddleware, deleteBillingCycle);
router.post("/auto-generate", adminMiddleware, autoGenerateMonthlyBills);
router.post("/auto-reminders", adminMiddleware, autoSendReminders);
router.post("/auto-suspend", adminMiddleware, autoSuspendOverdue);
router.post("/recover-missing-bills", adminMiddleware, recoverMissingBills);
router.post(
  "/initialize-backdated",
  adminMiddleware,
  initializeBackdatedBilling,
);
router.post(
  "/manually-generate-month",
  adminMiddleware,
  manuallyGenerateBillsForMonth,
);

// ==================== APPLICATION ROUTES ====================
router.get("/application/:applicationId/current", getApplicationCurrentBilling);
router.get("/application/:applicationId/history", getApplicationBillingHistory);
router.get("/application/:applicationId/status", getApplicationBillingStatus);
router.post("/application/submit-pro-rated", submitProRatedPayment);
router.post("/application/submit-installation", submitInstallationPayment);
router.post("/application/submit-monthly", submitMonthlyPayment);

export default router;
