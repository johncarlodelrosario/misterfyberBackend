// backend/src/routes/invoiceRoutes.ts

import express from "express";
import { body } from "express-validator";
import {
  createInvoiceFromBilling,
  generateInvoicePDFController,
  sendInvoiceWithPDF,
  markInvoiceAsPaid,
  getInvoices,
  getInvoice,
  getInvoicePDF,
  getApplicationInvoices,
  deleteInvoice,
  updateInvoice,
  getInvoiceStats,
} from "../controllers/invoiceController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// ==================== ADMIN ROUTES ====================
router.post(
  "/create",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("applicationId")
      .optional()
      .notEmpty()
      .withMessage("Application ID is required"),
    body("billingId")
      .optional()
      .notEmpty()
      .withMessage("Billing ID is required"),
  ],
  createInvoiceFromBilling,
);

router.post(
  "/:invoiceId/generate-pdf",
  protect,
  authorize("super_admin", "admin", "staff"),
  generateInvoicePDFController,
);

router.post(
  "/:invoiceId/send",
  protect,
  authorize("super_admin", "admin", "staff"),
  sendInvoiceWithPDF,
);

router.put(
  "/:invoiceId/mark-paid",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("referenceNumber")
      .optional()
      .notEmpty()
      .withMessage("Reference number is required"),
  ],
  markInvoiceAsPaid,
);

router.put(
  "/:invoiceId",
  protect,
  authorize("super_admin", "admin", "staff"),
  updateInvoice,
);

router.delete(
  "/:invoiceId",
  protect,
  authorize("super_admin", "admin"),
  deleteInvoice,
);

// ==================== PUBLIC ROUTES (with authentication) ====================
router.get(
  "/",
  protect,
  authorize("super_admin", "admin", "staff"),
  getInvoices,
);

router.get(
  "/stats",
  protect,
  authorize("super_admin", "admin", "staff"),
  getInvoiceStats,
);

router.get(
  "/:invoiceId",
  protect,
  authorize("super_admin", "admin", "staff"),
  getInvoice,
);

router.get(
  "/:invoiceId/pdf",
  protect,
  authorize("super_admin", "admin", "staff"),
  getInvoicePDF,
);

router.get(
  "/application/:applicationId",
  protect,
  authorize("super_admin", "admin", "staff"),
  getApplicationInvoices,
);

export default router;
