// backend/src/routes/manualEmailRoutes.ts - COMPLETE FIXED VERSION

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

import { protect, adminOnly } from "../middleware/auth";

const router = Router();

// ============================================================
// ALL ROUTES REQUIRE AUTHENTICATION + ADMIN ACCESS
// ============================================================
router.use(protect);
router.use(adminOnly);

// ============================================================
// CUSTOMER ROUTES
// ============================================================
router.get("/customers", getCustomersForEmail);
router.get("/customers/:applicationId/bills", getCustomerBills);

// ============================================================
// SEND EMAIL ROUTES
// ============================================================
router.post("/send", sendManualEmail);
router.post("/send-bulk", sendBulkEmails);
router.post("/send-reminder-unpaid", sendReminderToUnpaid);

// ============================================================
// TEMPLATE ROUTES
// ============================================================
router.get("/templates", getEmailTemplates);
router.post("/templates", saveEmailTemplate);
router.put("/templates/:templateId", updateEmailTemplate);
router.delete("/templates/:templateId", deleteEmailTemplate);

// ============================================================
// PREVIEW ROUTE
// ============================================================
router.post("/preview", previewEmail);

// ============================================================
// SENT RECORDS ROUTES
// ============================================================
router.get("/sent-records", getSentRecords);
router.delete("/sent-records/:recordId", deleteSentRecord);

// ============================================================
// SCHEDULING ROUTES
// ============================================================
router.post("/schedule", scheduleEmail);
router.get("/schedules", getScheduledEmails);
router.put("/schedules/:scheduleId", updateScheduledEmail);
router.delete("/schedules/:scheduleId", deleteScheduledEmail);
router.post("/schedules/:scheduleId/cancel", cancelScheduledEmail);
router.get("/schedule-stats", getScheduleStats);
router.post("/schedules/process", forceProcessSchedules);

export default router;
