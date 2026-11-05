// backend/src/routes/paymentRoutes.ts

import express from "express";
import { body } from "express-validator";
import {
  createPayment,
  getPayments,
  getPayment,
  verifyPayment,
  payMongoWebhook,
  dragonPayWebhook,
  getPaymentStats,
  refundPayment,
  confirmPayment,
  updatePayment,
  rejectPayment,
  getPendingPayments,
  getAllPaymentsAdmin,
  getInstallationPaymentSummary,
  deletePayment,
  bulkDeleteCustomerPayments,
  fixProRatedPaymentTypes,
} from "../controllers/paymentController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// Webhooks (public)
router.post("/webhook/paymongo", payMongoWebhook);
router.post("/webhook/dragonpay", dragonPayWebhook);

// ==================== USER ROUTES ====================
router.post(
  "/",
  protect,
  [
    body("amount").isNumeric().withMessage("Amount must be a number"),
    body("billingId").notEmpty().withMessage("Billing ID is required"),
  ],
  createPayment,
);

router.get("/", protect, getPayments);
router.get("/verify/:reference", protect, verifyPayment);

// ==================== ADMIN ROUTES ====================
// NOTE: Admin routes MUST be declared before `/:id` to avoid being swallowed
router.get(
  "/admin/all",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllPaymentsAdmin,
);

router.get(
  "/admin/pending",
  protect,
  authorize("super_admin", "admin", "staff"),
  getPendingPayments,
);

router.get(
  "/admin/stats",
  protect,
  authorize("super_admin", "admin", "staff"),
  getPaymentStats,
);

router.get(
  "/admin/installation/summary",
  protect,
  authorize("super_admin", "admin", "staff"),
  getInstallationPaymentSummary,
);

router.post(
  "/admin/fix-pro-rated-types",
  protect,
  authorize("super_admin"),
  fixProRatedPaymentTypes,
);

router.delete(
  "/bulk/customer/:customerId",
  protect,
  authorize("super_admin", "admin", "staff"),
  bulkDeleteCustomerPayments,
);

router.put(
  "/:id/confirm",
  protect,
  authorize("super_admin", "admin", "staff"),
  confirmPayment,
);

router.put(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  updatePayment,
);

router.put(
  "/:id/reject",
  protect,
  authorize("super_admin", "admin", "staff"),
  rejectPayment,
);

router.post(
  "/:id/refund",
  protect,
  authorize("super_admin", "admin", "staff"),
  refundPayment,
);

router.delete(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  deletePayment,
);

// Keep `/:id` GET last so it doesn't shadow `/verify/...`
router.get("/:id", protect, getPayment);

export default router;
