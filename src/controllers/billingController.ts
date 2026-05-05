// controllers/billingController.ts - COMPLETE FIXED FILE
import { Request, Response, NextFunction } from "express";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import BillingSettings from "../models/BillingSettings";
import User from "../models/User";
import Plan from "../models/Plan";
import Payment from "../models/Payment";
import emailService from "../services/emailService";
import mikrotikService from "../services/mikrotikService";
import mongoose from "mongoose";

interface AuthRequest extends Request {
  user?: any;
}

// ==================== START BILLING WITH PRO-RATED CALCULATION ====================
export const startBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, startDate, customAmount, notes } = req.body;

    const user = await User.findById(userId).populate("planId");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.planId) {
      return res
        .status(400)
        .json({ success: false, message: "User has no plan assigned" });
    }

    const plan = user.planId as any;
    const monthlyRate = plan.price;
    let startDateTime = startDate ? new Date(startDate) : new Date();
    startDateTime.setHours(0, 0, 0, 0);

    // Check if billing cycle already exists
    const existingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["active", "paused"] },
    });

    if (existingCycle) {
      return res.status(400).json({
        success: false,
        message: "User already has an active billing cycle",
        data: { billingCycle: existingCycle },
      });
    }

    // Calculate pro-rated amount based on actual start date
    const lastDayOfMonth = new Date(
      startDateTime.getFullYear(),
      startDateTime.getMonth() + 1,
      0,
    );
    const daysInMonth = lastDayOfMonth.getDate();
    const currentDay = startDateTime.getDate();

    // Calculate remaining days in current month (including current day)
    let remainingDays = daysInMonth - currentDay + 1;
    let isProRated = false;
    let proRatedAmount = monthlyRate;

    // PRO-RATED: If start date is not the 1st day of month
    if (currentDay > 1 && !customAmount) {
      isProRated = true;
      const dailyRate = monthlyRate / daysInMonth;
      proRatedAmount = Math.round(dailyRate * remainingDays * 100) / 100;
    }

    const finalAmount = customAmount || proRatedAmount;

    // Calculate next billing date (start of next month)
    const nextBillingDate = new Date(startDateTime);
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    nextBillingDate.setDate(1);
    nextBillingDate.setHours(0, 0, 0, 0);

    // Get billing settings
    let settings = await BillingSettings.findOne();
    if (!settings) {
      settings = await BillingSettings.create({
        reminderDays: [7, 3, 1],
        dueDateDaysAfterPeriod: 7,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
      });
    }

    // Calculate billing period end (last day of the month)
    const billingEndDate = new Date(startDateTime);
    billingEndDate.setMonth(billingEndDate.getMonth() + 1);
    billingEndDate.setDate(0);
    billingEndDate.setHours(23, 59, 59, 999);

    // Calculate due date (7 days after period end)
    const dueDate = new Date(billingEndDate);
    dueDate.setDate(dueDate.getDate() + settings.dueDateDaysAfterPeriod);
    dueDate.setHours(23, 59, 59, 999);

    // Create billing cycle
    const billingCycle = await BillingCycle.create(
      [
        {
          userId,
          planId: plan._id,
          billingStartDate: startDateTime,
          billingEndDate: billingEndDate,
          nextBillingDate: nextBillingDate,
          status: "active",
          monthlyRate,
          currentProRatedAmount: isProRated ? finalAmount : 0,
        },
      ],
      { session },
    );

    // Create initial bill (PRO-RATED if applicable)
    let bill = null;
    if (finalAmount > 0) {
      const billingPeriodStart = new Date(startDateTime);
      billingPeriodStart.setHours(0, 0, 0, 0);

      const billingPeriodEnd = new Date(billingEndDate);
      billingPeriodEnd.setHours(23, 59, 59, 999);

      const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 10000)}`;

      let description = "";
      if (isProRated) {
        description = `${plan.name} - Pro-rated (${remainingDays} days) from ${billingPeriodStart.toLocaleDateString()} to ${billingPeriodEnd.toLocaleDateString()}`;
      } else {
        description = `${plan.name} - Full Month Subscription (${billingPeriodStart.toLocaleDateString()} to ${billingPeriodEnd.toLocaleDateString()})`;
      }

      bill = await Billing.create(
        [
          {
            userId,
            billingCycleId: billingCycle[0]._id,
            invoiceNumber,
            billingPeriod: {
              start: billingPeriodStart,
              end: billingPeriodEnd,
            },
            dueDate,
            items: [
              {
                description: description,
                quantity: isProRated ? remainingDays : 1,
                rate: isProRated ? monthlyRate / daysInMonth : monthlyRate,
                amount: finalAmount,
              },
            ],
            subtotal: finalAmount,
            tax: 0,
            discount: 0,
            total: finalAmount,
            status: "sent", // Status remains "sent" until paid
            isProRated,
            proRatedDays: isProRated ? remainingDays : 0,
            notes:
              notes ||
              (isProRated
                ? `Pro-rated billing from ${billingPeriodStart.toLocaleDateString()} to ${billingPeriodEnd.toLocaleDateString()}`
                : "Initial billing"),
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();

    // Update user billing info
    user.billingInfo = {
      ...user.billingInfo,
      currentBill: finalAmount,
      nextBillingDate: nextBillingDate,
      billingCycleId: billingCycle[0]._id,
    };
    await user.save();

    // Send notification to user
    if (bill && bill[0]) {
      await emailService.sendInvoice(user, bill[0]);
    }

    res.status(200).json({
      success: true,
      message: `Billing started successfully for ${user.firstName} ${user.lastName}`,
      data: {
        billingCycle: billingCycle[0],
        initialBill: bill ? bill[0] : null,
        isProRated,
        proRatedAmount: isProRated ? finalAmount : null,
        remainingDays: isProRated ? remainingDays : null,
        nextBillingDate,
        dueDate,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== STOP BILLING ====================
export const stopBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    });

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found for this user",
      });
    }

    // Check for unpaid bills
    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue"] },
    });

    if (unpaidBills) {
      return res.status(400).json({
        success: false,
        message:
          "User has unpaid bills. Please settle before stopping billing.",
      });
    }

    // Update billing cycle status
    billingCycle.status = "cancelled";
    billingCycle.billingEndDate = new Date();
    await billingCycle.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `Billing stopped for ${user.firstName} ${user.lastName}`,
      data: { billingCycle },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== GENERATE MANUAL BILL ====================
export const generateBill = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, amount, description, dueDate } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    });
    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found. Please start billing first.",
      });
    }

    const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 10000)}`;

    const billingStart = new Date();
    billingStart.setDate(1);
    billingStart.setHours(0, 0, 0, 0);

    const billingEnd = new Date(billingStart);
    billingEnd.setMonth(billingEnd.getMonth() + 1);
    billingEnd.setDate(0);
    billingEnd.setHours(23, 59, 59, 999);

    const finalDueDate = dueDate ? new Date(dueDate) : new Date(billingEnd);
    if (!dueDate) {
      finalDueDate.setDate(finalDueDate.getDate() + 7);
    }

    const bill = await Billing.create({
      userId,
      billingCycleId: billingCycle._id,
      invoiceNumber,
      billingPeriod: { start: billingStart, end: billingEnd },
      dueDate: finalDueDate,
      items: [
        {
          description: description || "Monthly Subscription",
          quantity: 1,
          rate: amount,
          amount: amount,
        },
      ],
      subtotal: amount,
      tax: 0,
      discount: 0,
      total: amount,
      status: "sent",
      isProRated: false,
      proRatedDays: 0,
      notes: `Manual bill generated by ${req.user?.email}`,
    });

    try {
      await emailService.sendInvoice(user, bill);
    } catch (emailError) {
      console.error("Failed to send invoice email:", emailError);
    }

    res.status(201).json({
      success: true,
      message: "Bill generated successfully",
      data: bill,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET BILLING SUMMARY ====================
export const getBillingSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;

    const currentBill = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue"] },
    }).sort({ dueDate: 1 });

    const lastPayment = await Payment.findOne({
      userId,
      status: "completed",
    }).sort({ paidAt: -1 });

    const paymentHistory = await Payment.find({ userId, status: "completed" })
      .sort({ paidAt: -1 })
      .limit(5);

    const billingHistory = await Billing.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      data: {
        currentBill: currentBill || null,
        lastPayment: lastPayment || null,
        paymentHistory: paymentHistory || [],
        billingHistory: billingHistory || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== USER BILLING CYCLE ====================
export const getUserBillingCycle = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    }).populate("planId", "name price speed description features");

    if (!billingCycle) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No active billing cycle found",
      });
    }

    const upcomingBills = await Billing.find({
      userId,
      status: "sent",
      dueDate: { $gt: new Date() },
    }).sort({ dueDate: 1 });

    const overdueBills = await Billing.find({
      userId,
      status: "overdue",
      dueDate: { $lt: new Date() },
    });

    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        upcomingBills,
        hasOverdue: overdueBills.length > 0,
        overdueCount: overdueBills.length,
        overdueAmount: overdueBills.reduce((sum, bill) => sum + bill.total, 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET CURRENT BILL ====================
export const getCurrentBill = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    const currentBill = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue"] },
    }).sort({ dueDate: 1 });
    res.status(200).json({ success: true, data: currentBill || null });
  } catch (error) {
    next(error);
  }
};

// ==================== GET BILLING HISTORY ====================
export const getBillingHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    const bills = await Billing.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.status(200).json({ success: true, data: bills });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL BILLING CYCLES (ADMIN) ====================
export const getAllBillingCycles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cycles = await BillingCycle.find()
      .populate("userId", "firstName lastName email")
      .populate("planId", "name")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: cycles });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL BILLS (ADMIN) ====================
export const getAllBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bills = await Billing.find()
      .populate("userId", "firstName lastName email")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: bills });
  } catch (error) {
    next(error);
  }
};

// ==================== BILLING SETTINGS ====================
export const getBillingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    let settings = await BillingSettings.findOne();
    if (!settings) {
      settings = await BillingSettings.create({
        reminderDays: [7, 3, 1],
        dueDateDaysAfterPeriod: 7,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
      });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

export const updateBillingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    let settings = await BillingSettings.findOne();
    if (!settings) {
      settings = new BillingSettings(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ==================== VOID BILL ====================
export const voidBill = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { billId } = req.params;
    const { reason } = req.body;

    const bill = await Billing.findById(billId);
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }

    bill.status = "cancelled";
    bill.notes = `${bill.notes || ""} \n VOIDED: ${reason || "No reason provided"} by ${req.user?.email}`;
    await bill.save();

    res.status(200).json({
      success: true,
      message: "Bill voided successfully",
      data: bill,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== PLAN CHANGE FUNCTIONS ====================
export const requestPlanChange = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { newPlanId, effectiveDate } = req.body;
    const userId = req.user?._id;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const newPlan = await Plan.findById(newPlanId);
    if (!newPlan) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    });
    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found. Please contact admin.",
      });
    }

    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue"] },
    });

    if (unpaidBills) {
      return res.status(400).json({
        success: false,
        message: "Please settle outstanding bills before changing plan",
      });
    }

    billingCycle.pendingPlanChange = {
      newPlanId: newPlan._id,
      requestedAt: new Date(),
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      status: "pending",
    };
    await billingCycle.save();

    res.status(200).json({
      success: true,
      message: "Plan change request submitted. Waiting for admin approval.",
      data: {
        requestedPlan: newPlan,
        effectiveDate: effectiveDate || new Date(),
        status: "pending",
      },
    });
  } catch (error) {
    next(error);
  }
};

export const approvePlanChange = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, approvalNotes } = req.body;

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
      "pendingPlanChange.status": "pending",
    });

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No pending plan change request found",
      });
    }

    const newPlan = await Plan.findById(
      billingCycle.pendingPlanChange!.newPlanId,
    );
    if (!newPlan) {
      return res
        .status(404)
        .json({ success: false, message: "New plan not found" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    billingCycle.planId = newPlan._id;
    billingCycle.monthlyRate = newPlan.price;
    billingCycle.pendingPlanChange!.status = "approved";
    await billingCycle.save({ session });

    user.planId = newPlan._id;
    await user.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `Plan change to ${newPlan.name} approved successfully`,
      data: {
        newPlan,
        effectiveDate: billingCycle.pendingPlanChange!.effectiveDate,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

export const rejectPlanChange = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, rejectionReason } = req.body;

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
      "pendingPlanChange.status": "pending",
    });

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No pending plan change request found",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const requestedPlan = await Plan.findById(
      billingCycle.pendingPlanChange!.newPlanId,
    );

    billingCycle.pendingPlanChange!.status = "rejected";
    await billingCycle.save();

    res.status(200).json({
      success: true,
      message: "Plan change request rejected",
      data: { requestedPlan, rejectionReason },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== CLIENT MANAGEMENT ====================
export const disconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, reason } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    user.status = "suspended";
    await user.save();

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    });
    if (billingCycle) {
      billingCycle.status = "paused";
      billingCycle.serviceSuspendedAt = new Date();
      await billingCycle.save();
    }

    res.status(200).json({
      success: true,
      message: `Service disconnected for ${user.firstName} ${user.lastName}`,
      data: {
        userId: user._id,
        status: "suspended",
        reason: reason || "Non-payment",
      },
    });
  } catch (error) {
    next(error);
  }
};

export const reconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId).populate("planId");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue"] },
    });

    if (unpaidBills) {
      return res.status(400).json({
        success: false,
        message: "User has unpaid bills. Please settle before reconnecting.",
      });
    }

    user.status = "active";
    await user.save();

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "paused",
    });
    if (billingCycle) {
      billingCycle.status = "active";
      billingCycle.serviceSuspendedAt = undefined;
      await billingCycle.save();
    }

    res.status(200).json({
      success: true,
      message: `Service reconnected for ${user.firstName} ${user.lastName}`,
      data: { userId: user._id, status: "active" },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== REMINDER ====================
export const setReminder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, reminderDate, reminderType, customMessage } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const reminderDateTime = new Date(reminderDate);
    const today = new Date();
    if (reminderDateTime.toDateString() === today.toDateString()) {
      await emailService.sendEmail(
        user.email,
        "Payment Reminder",
        `<p>${customMessage || `This is a reminder that your payment is due on ${reminderDateTime.toLocaleDateString()}. Please settle your bill to avoid service interruption.`}</p>
         <p>Please log in to your dashboard to make a payment.</p>
         <a href="${process.env.FRONTEND_URL}/user/billing">Pay Now</a>`,
      );
    }

    res.status(200).json({
      success: true,
      message: `Reminder scheduled for ${reminderDateTime.toLocaleString()}`,
      data: {
        userId,
        type: reminderType || "billing",
        scheduledFor: reminderDateTime,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== SCHEDULED JOBS ====================
export const autoGenerateBills = async () => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoGenerateBills) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const billingCycles = await BillingCycle.find({
      status: "active",
      nextBillingDate: { $lte: today },
    }).populate("userId planId");

    console.log(`🔄 Auto-generating bills for ${billingCycles.length} cycles`);

    for (const cycle of billingCycles) {
      const user = cycle.userId as any;
      const plan = cycle.planId as any;

      if (!user || !plan) continue;

      // Check for unpaid previous bills - DO NOT generate new bill if unpaid
      const unpaidBills = await Billing.findOne({
        userId: user._id,
        status: { $in: ["sent", "overdue"] },
      });

      if (unpaidBills) {
        console.log(
          `⚠️ User ${user.email} has unpaid bills. Skipping auto-generation.`,
        );
        continue;
      }

      const billingStart = new Date(cycle.nextBillingDate);
      billingStart.setHours(0, 0, 0, 0);

      const billingEnd = new Date(billingStart);
      billingEnd.setMonth(billingEnd.getMonth() + 1);
      billingEnd.setDate(0);
      billingEnd.setHours(23, 59, 59, 999);

      const dueDate = new Date(billingEnd);
      dueDate.setDate(dueDate.getDate() + settings.dueDateDaysAfterPeriod);
      dueDate.setHours(23, 59, 59, 999);

      const existingBill = await Billing.findOne({
        userId: user._id,
        "billingPeriod.start": billingStart,
      });

      if (!existingBill) {
        const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 10000)}`;

        const bill = await Billing.create({
          userId: user._id,
          billingCycleId: cycle._id,
          invoiceNumber,
          billingPeriod: { start: billingStart, end: billingEnd },
          dueDate,
          items: [
            {
              description: `${plan.name} - Monthly Subscription (${billingStart.toLocaleDateString()} to ${billingEnd.toLocaleDateString()})`,
              quantity: 1,
              rate: plan.price,
              amount: plan.price,
            },
          ],
          subtotal: plan.price,
          total: plan.price,
          status: "sent",
          isProRated: false,
        });

        const nextDate = new Date(billingStart);
        nextDate.setMonth(nextDate.getMonth() + 1);
        cycle.nextBillingDate = nextDate;
        await cycle.save();

        try {
          await emailService.sendInvoice(user, bill);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }

        console.log(
          `✅ Auto-generated bill for ${user.email}: ₱${plan.price} - ${invoiceNumber}`,
        );
      }
    }
  } catch (error) {
    console.error("Auto-generate bills error:", error);
  }
};

export const autoSendReminders = async () => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoSendReminders) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bills = await Billing.find({
      status: { $in: ["sent", "overdue"] },
    }).populate("userId");

    for (const bill of bills) {
      const user = bill.userId as any;
      if (!user) continue;

      const daysUntilDue = Math.ceil(
        (bill.dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      const daysOverdue = Math.ceil(
        (today.getTime() - bill.dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilDue === 3 && !bill.reminder3DaySent) {
        await emailService.sendPaymentReminder(user, bill);
        bill.reminder3DaySent = true;
        await bill.save();
      }

      if (daysUntilDue === 1 && !bill.reminder1DaySent) {
        await emailService.sendPaymentReminder(user, bill);
        bill.reminder1DaySent = true;
        await bill.save();
      }

      if (daysUntilDue === 0 && !bill.reminderDueDateSent) {
        await emailService.sendEmail(
          user.email,
          `⚠️ Payment Due Today - ${bill.invoiceNumber}`,
          `<p>Your payment of ₱${bill.total.toFixed(2)} is due TODAY.</p>`,
        );
        bill.reminderDueDateSent = true;
        await bill.save();
      }

      if (daysOverdue > 0 && bill.status === "sent") {
        bill.status = "overdue";
        await bill.save();
      }
    }
  } catch (error) {
    console.error("Auto-send reminders error:", error);
  }
};

export const autoSuspendOverdue = async () => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoSuspendOnNonPayment) return;

    const today = new Date();
    const fiveDaysAgo = new Date(today);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const overdueBills = await Billing.find({
      status: "overdue",
      dueDate: { $lt: fiveDaysAgo },
      suspensionNotified: { $ne: true },
    }).populate("userId");

    for (const bill of overdueBills) {
      const user = bill.userId as any;
      if (!user) continue;

      bill.suspensionNotified = true;
      await bill.save();

      user.status = "suspended";
      await user.save();
    }
  } catch (error) {
    console.error("Auto-suspend overdue error:", error);
  }
};

// ==================== EXPORT ALL ====================
export default {
  startBilling,
  stopBilling,
  generateBill,
  voidBill,
  requestPlanChange,
  approvePlanChange,
  rejectPlanChange,
  setReminder,
  disconnectClient,
  reconnectClient,
  getBillingSettings,
  updateBillingSettings,
  getAllBillingCycles,
  getUserBillingCycle,
  getAllBills,
  getCurrentBill,
  getBillingHistory,
  getBillingSummary,
  autoGenerateBills,
  autoSendReminders,
  autoSuspendOverdue,
};
