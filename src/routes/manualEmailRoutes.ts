import express from "express";
import {
  getCustomersForEmail,
  getCustomerBills,
  sendManualEmail,
  sendBulkEmails,
  saveEmailTemplate,
  getEmailTemplates,
  deleteEmailTemplate,
  previewEmail,
  sendReminderToUnpaid,
} from "../controllers/manualEmailController";
import { protect, adminMiddleware } from "../middleware/auth";

const router = express.Router();

// All routes require authentication and admin access
router.use(protect);
router.use(adminMiddleware);

// Customer management
router.get("/customers", getCustomersForEmail);
router.get("/customers/:applicationId/bills", getCustomerBills);

// Email sending
router.post("/send", sendManualEmail);
router.post("/send-bulk", sendBulkEmails);
router.post("/send-reminder-unpaid", sendReminderToUnpaid);

// Template management
router.get("/templates", getEmailTemplates);
router.post("/templates", saveEmailTemplate);
router.delete("/templates/:templateId", deleteEmailTemplate);

// Preview
router.post("/preview", previewEmail);

export default router;
