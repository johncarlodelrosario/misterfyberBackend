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
  rejectPayment,
  getPendingPayments,
  getAllPaymentsAdmin,
  getInstallationPaymentSummary,
} from "../controllers/paymentController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// Webhooks (public - no authentication)
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
router.get("/:id", protect, getPayment);

// ==================== ADMIN ROUTES ====================
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

router.put(
  "/:id/confirm",
  protect,
  authorize("super_admin", "admin", "staff"),
  confirmPayment,
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

export default router;
