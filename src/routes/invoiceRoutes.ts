import express from "express";
import { body } from "express-validator";
import * as invoiceController from "../controllers/invoiceController";
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
  invoiceController.createInvoiceFromBilling,
);

router.post(
  "/:invoiceId/generate-pdf",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.generateInvoicePDFController,
);

router.post(
  "/:invoiceId/send",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.sendInvoiceWithPDF,
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
  invoiceController.markInvoiceAsPaid,
);

router.put(
  "/:invoiceId",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.updateInvoice,
);

router.delete(
  "/:invoiceId",
  protect,
  authorize("super_admin", "admin"),
  invoiceController.deleteInvoice,
);

// ==================== PUBLIC ROUTES (with authentication) ====================
router.get(
  "/",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.getInvoices,
);

router.get(
  "/stats",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.getInvoiceStats,
);

router.get(
  "/:invoiceId",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.getInvoice,
);

router.get(
  "/:invoiceId/pdf",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.getInvoicePDF,
);

router.get(
  "/application/:applicationId",
  protect,
  authorize("super_admin", "admin", "staff"),
  invoiceController.getApplicationInvoices,
);

export default router;
