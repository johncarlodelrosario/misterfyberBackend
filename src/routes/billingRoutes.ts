// routes/billingRoutes.ts - COMPLETE FIXED FILE
import express from "express";
import { body } from "express-validator";
import {
  getCurrentBill,
  getBillingHistory,
  requestPlanChange as userRequestPlanChange,
  getUserBillingCycle,
} from "../controllers/billingController";
import {
  startBilling,
  stopBilling,
  approvePlanChange,
  rejectPlanChange,
  setReminder,
  disconnectClient,
  reconnectClient,
  getAllBillingCycles,
  getAllBills,
  getBillingSettings,
  updateBillingSettings,
} from "../controllers/billingController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// ==================== USER ROUTES ====================
// These only require authentication, not admin role
router.get("/current", protect, getCurrentBill);
router.get("/history", protect, getBillingHistory);
router.get("/my-cycle", protect, getUserBillingCycle);
router.post(
  "/request-plan-change",
  protect,
  [body("newPlanId").isMongoId().withMessage("Valid plan ID is required")],
  userRequestPlanChange,
);

// ==================== ADMIN ROUTES ====================
// All admin routes MUST have protect + authorize with ALL THREE roles
// IMPORTANT: Do NOT use router.use() - apply middleware to each route individually

// Billing Cycle Management
router.get(
  "/cycles",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBillingCycles,
);

router.get(
  "/all-bills",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBills,
);

router.get(
  "/settings",
  protect,
  authorize("super_admin", "admin", "staff"),
  getBillingSettings,
);

router.put(
  "/settings",
  protect,
  authorize("super_admin", "admin", "staff"),
  updateBillingSettings,
);

router.post(
  "/start",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("startDate").optional().isISO8601(),
    body("customAmount").optional().isNumeric(),
  ],
  startBilling,
);

router.post(
  "/stop",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  stopBilling,
);

router.post(
  "/plan-change/approve",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("approvalNotes").optional().isString(),
  ],
  approvePlanChange,
);

router.post(
  "/plan-change/reject",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("rejectionReason").optional().isString(),
  ],
  rejectPlanChange,
);

router.post(
  "/set-reminder",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("userId").isMongoId().withMessage("User ID is required"),
    body("reminderDate")
      .isISO8601()
      .withMessage("Valid reminder date is required"),
  ],
  setReminder,
);

router.post(
  "/disconnect",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  disconnectClient,
);

router.post(
  "/reconnect",
  protect,
  authorize("super_admin", "admin", "staff"),
  [body("userId").isMongoId().withMessage("User ID is required")],
  reconnectClient,
);

export default router;
