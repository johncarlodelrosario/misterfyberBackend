// backend/src/routes/manualEmailRoutes.ts

import { Router } from "express";
import {
  getCustomersForEmail,
  getCustomerBills,
  sendManualEmail,
  sendBulkEmails,
  saveEmailTemplate,
  getEmailTemplates,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmail,
  sendReminderToUnpaid,
  getSentRecords,
  deleteSentRecord,
  scheduleEmail,
  getScheduledEmails,
  updateScheduledEmail,
  deleteScheduledEmail,
  cancelScheduledEmail,
  getScheduleStats,
  forceProcessSchedules,
} from "../controllers/emailController";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// All routes require authentication and admin access
router.use(authMiddleware);

// Customer routes
router.get("/customers", getCustomersForEmail);
router.get("/customers/:applicationId/bills", getCustomerBills);

// Send email routes
router.post("/send", sendManualEmail);
router.post("/send-bulk", sendBulkEmails);
router.post("/send-reminder-unpaid", sendReminderToUnpaid);

// Template routes
router.get("/templates", getEmailTemplates);
router.post("/templates", saveEmailTemplate);
router.put("/templates/:templateId", updateEmailTemplate);
router.delete("/templates/:templateId", deleteEmailTemplate);

// Preview route
router.post("/preview", previewEmail);

// Sent records routes
router.get("/sent-records", getSentRecords);
router.delete("/sent-records/:recordId", deleteSentRecord);

// Scheduling routes
router.post("/schedule", scheduleEmail);
router.get("/schedules", getScheduledEmails);
router.put("/schedules/:scheduleId", updateScheduledEmail);
router.delete("/schedules/:scheduleId", deleteScheduledEmail);
router.post("/schedules/:scheduleId/cancel", cancelScheduledEmail);
router.get("/schedule-stats", getScheduleStats);
router.post("/schedules/process", forceProcessSchedules);

export default router;
