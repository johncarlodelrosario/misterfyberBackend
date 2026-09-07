// backend/src/routes/billingRoutes.ts - COMPLETE FIXED VERSION WITH PRICE EDIT ROUTE

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
  markBillAsFree,
  markInstallationBillAsPaid,
  markInstallationBillAsFree,
  getPendingProRatedBills,
  getPendingInstallationBills,
  getPendingActivations,
  confirmProRatedPayment,
  startMonthlyBilling,
  autoGenerateMonthlyBills,
  autoGenerateEarlyBills,
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
  getDashboardData,
  checkForUpdates,
  manuallyGenerateEarlyBill,
  checkForNewCustomers,
  updateBillPrice, // ADDED
} from "../controllers/billingController";

const router = express.Router();

console.log("🔄 Registering billing routes...");

// ==================== USE OPTIONAL AUTH ====================
router.use(optionalAuth);

// ==================== DASHBOARD DATA ENDPOINTS ====================
router.get("/dashboard-data", adminMiddleware, getDashboardData);
router.get("/has-updates", adminMiddleware, checkForUpdates);
console.log("✅ /dashboard-data route registered");

// ==================== ADMIN ROUTES (VIEW ONLY) ====================
router.get("/settings", getBillingSettings);
router.get("/cycles", getAllBillingCycles);
router.get("/all-bills", getAllBills);
router.get("/summary", getBillingSummaryAdmin);
router.get("/pending-pro-rated", getPendingProRatedBills);
router.get("/pending-installation", getPendingInstallationBills);
router.get("/pending-activations", getPendingActivations);
router.get("/unpaid-bills-report", adminMiddleware, getUnpaidBillsReport);
router.get("/check-new-customers", adminMiddleware, checkForNewCustomers);

// ==================== LOCATION EMAIL ROUTES ====================
router.get("/location/emails", adminMiddleware, getLocationEmails);
router.post("/location/test", adminMiddleware, testLocationEmail);

// ==================== ADMIN ROUTES (NEED ADMIN ROLE) ====================
router.put("/settings", adminMiddleware, updateBillingSettings);
router.get("/settings/admin", adminMiddleware, getBillingSettingsAdmin);
router.put("/settings/admin", adminMiddleware, updateBillingSettingsAdmin);

// ===== MARK PAID ROUTES =====
router.put("/mark-paid/:billId", adminMiddleware, markBillAsPaid);
router.put(
  "/mark-installation-paid/:billId",
  adminMiddleware,
  markInstallationBillAsPaid,
);

// ===== MARK FREE ROUTES =====
router.put("/mark-free/:billId", adminMiddleware, markBillAsFree);
router.put(
  "/mark-installation-free/:billId",
  adminMiddleware,
  markInstallationBillAsFree,
);

// ===== UPDATE PRICE ROUTE =====
router.put("/update-price/:billId", adminMiddleware, updateBillPrice);
console.log("✅ /update-price/:billId route registered");

// ===== BILLING ACTION ROUTES =====
router.post("/confirm-pro-rated", adminMiddleware, confirmProRatedPayment);
router.post("/start-monthly", adminMiddleware, startMonthlyBilling);
router.post("/start", adminMiddleware, startBilling);
router.post("/stop", adminMiddleware, stopBilling);
router.post("/pause", adminMiddleware, pauseBilling);
router.post("/resume", adminMiddleware, resumeBilling);
router.post("/disconnect", adminMiddleware, disconnectClient);
router.post("/reconnect", adminMiddleware, reconnectClient);
router.delete("/delete-cycle", adminMiddleware, deleteBillingCycle);

// ===== AUTO GENERATION ROUTES =====
router.post("/auto-generate", adminMiddleware, autoGenerateMonthlyBills);
router.post(
  "/auto-generate-early-bills",
  adminMiddleware,
  autoGenerateEarlyBills,
);
router.post("/auto-suspend", adminMiddleware, autoSuspendOverdue);

// ===== RECOVERY & BACKDATED ROUTES =====
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
router.post(
  "/manually-generate-early-bill",
  adminMiddleware,
  manuallyGenerateEarlyBill,
);

// ==================== APPLICATION ROUTES ====================
router.get("/application/:applicationId/current", getApplicationCurrentBilling);
router.get("/application/:applicationId/history", getApplicationBillingHistory);
router.get("/application/:applicationId/status", getApplicationBillingStatus);
router.post("/application/submit-pro-rated", submitProRatedPayment);
router.post("/application/submit-installation", submitInstallationPayment);
router.post("/application/submit-monthly", submitMonthlyPayment);

console.log("✅ All billing routes registered");

export default router;
