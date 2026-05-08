// controllers/billingController.ts - COMPLETE FIXED
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

// Helper function to generate invoice number
function generateInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `INV-${year}${month}-${timestamp}${random}`;
}

// ==================== AUTO SEND REMINDERS ====================
export const autoSendReminders = async () => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoSendReminders) {
      console.log("Auto-send reminders is disabled");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminderDays = settings.reminderDays || [7, 3, 1];

    for (const days of reminderDays) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      targetDate.setHours(23, 59, 59, 999);

      let reminderField: string;
      if (days === 7) reminderField = "reminder7DaySent";
      else if (days === 3) reminderField = "reminder3DaySent";
      else if (days === 1) reminderField = "reminder1DaySent";
      else continue;

      const bills = await Billing.find({
        status: "sent",
        dueDate: {
          $gte: new Date(targetDate.setHours(0, 0, 0, 0)),
          $lte: targetDate,
        },
        [reminderField]: { $ne: true },
      }).populate("userId");

      for (const bill of bills) {
        const user = bill.userId as any;
        if (user && user.email) {
          await emailService.sendEmail(
            user.email,
            `Payment Reminder - Bill ${bill.invoiceNumber}`,
            `<p>Dear ${user.firstName} ${user.lastName},</p>
             <p>Your bill of ₱${bill.total.toFixed(2)} is due in ${days} day(s).</p>
             <p>Due Date: ${bill.dueDate.toLocaleDateString()}</p>
             <p>Please make your payment on time to avoid service interruption.</p>
             <p>Thank you,<br>Mister Fyber Team</p>`,
          );

          if (days === 7) bill.reminder7DaySent = true;
          else if (days === 3) bill.reminder3DaySent = true;
          else if (days === 1) bill.reminder1DaySent = true;
          await bill.save();

          console.log(
            `📧 Sent ${days}-day reminder for bill ${bill.invoiceNumber} to ${user.email}`,
          );
        }
      }
    }
  } catch (error) {
    console.error("Auto-send reminders error:", error);
  }
};

// ==================== START BILLING (PRO-RATED) ====================
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

    let installationDate = startDate ? new Date(startDate) : new Date();
    installationDate.setHours(0, 0, 0, 0);

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

    const lastDayOfMonth = new Date(
      installationDate.getFullYear(),
      installationDate.getMonth() + 1,
      0,
    );
    const daysInMonth = lastDayOfMonth.getDate();
    const installationDay = installationDate.getDate();
    const proRatedDays = daysInMonth - installationDay + 1;
    const dailyRate = monthlyRate / daysInMonth;
    const proRatedAmount = Math.round(dailyRate * proRatedDays * 100) / 100;

    const firstFullBillingStart = new Date(installationDate);
    firstFullBillingStart.setMonth(firstFullBillingStart.getMonth() + 1);
    firstFullBillingStart.setDate(1);
    firstFullBillingStart.setHours(0, 0, 0, 0);

    const firstFullBillingEnd = new Date(firstFullBillingStart);
    firstFullBillingEnd.setMonth(firstFullBillingEnd.getMonth() + 1);
    firstFullBillingEnd.setDate(0);
    firstFullBillingEnd.setHours(23, 59, 59, 999);

    const dueDate = new Date(firstFullBillingStart);
    dueDate.setDate(5);
    dueDate.setHours(23, 59, 59, 999);

    const nextBillingDate = new Date(firstFullBillingStart);
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    nextBillingDate.setDate(1);
    nextBillingDate.setHours(0, 0, 0, 0);

    const billingCycle = await BillingCycle.create(
      [
        {
          userId,
          planId: plan._id,
          billingStartDate: installationDate,
          billingEndDate: lastDayOfMonth,
          nextBillingDate: nextBillingDate,
          status: "active",
          monthlyRate,
          currentProRatedAmount: proRatedAmount,
          proRatedPaid: false,
        },
      ],
      { session },
    );

    const proRatedBill = await Billing.create(
      [
        {
          userId,
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: {
            start: installationDate,
            end: lastDayOfMonth,
          },
          dueDate: installationDate,
          items: [
            {
              description: `Pro-rated payment from ${installationDate.toLocaleDateString()} to ${lastDayOfMonth.toLocaleDateString()} (${proRatedDays} days)`,
              quantity: proRatedDays,
              rate: dailyRate,
              amount: proRatedAmount,
            },
          ],
          subtotal: proRatedAmount,
          tax: 0,
          discount: 0,
          total: proRatedAmount,
          status: "sent",
          isProRated: true,
          proRatedDays: proRatedDays,
          notes: notes || `Pro-rated billing upon installation`,
        },
      ],
      { session },
    );

    const fullMonthBill = await Billing.create(
      [
        {
          userId,
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: {
            start: firstFullBillingStart,
            end: firstFullBillingEnd,
          },
          dueDate: dueDate,
          items: [
            {
              description: `Monthly Subscription - ${firstFullBillingStart.toLocaleDateString()} to ${firstFullBillingEnd.toLocaleDateString()}`,
              quantity: 1,
              rate: monthlyRate,
              amount: monthlyRate,
            },
          ],
          subtotal: monthlyRate,
          tax: 0,
          discount: 0,
          total: monthlyRate,
          status: "draft",
          isProRated: false,
          proRatedDays: 0,
          notes: "Pending payment of pro-rated amount",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    user.billingInfo = {
      ...user.billingInfo,
      currentBill: proRatedAmount,
      nextBillingDate: nextBillingDate,
      billingCycleId: billingCycle[0]._id,
    };
    await user.save();

    await emailService.sendInvoice(user, proRatedBill[0]);

    res.status(200).json({
      success: true,
      message: `Billing started. Pro-rated amount of ₱${proRatedAmount.toFixed(2)} required.`,
      data: {
        billingCycle: billingCycle[0],
        proRatedBill: proRatedBill[0],
        fullMonthBill: fullMonthBill[0],
        proRatedAmount,
        proRatedDays,
        nextBillingDate: nextBillingDate,
        dueDateForNextBill: dueDate,
        requiresProRatedPayment: true,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== CONFIRM PRO-RATED PAYMENT ====================
export const confirmProRatedPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, paymentDetails } = req.body;

    const user = await User.findById(userId).populate("planId");
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
        message: "No active billing cycle found",
      });
    }

    const proRatedBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: true,
      status: "sent",
    });

    if (!proRatedBill) {
      return res.status(404).json({
        success: false,
        message: "Pro-rated bill not found or already paid",
      });
    }

    const payment = await Payment.create(
      [
        {
          userId,
          amount: proRatedBill.total,
          paymentMethod: paymentDetails?.paymentMethod || "manual",
          paymentType: "subscription",
          status: "completed",
          referenceNumber:
            paymentDetails?.referenceNumber || `PRO-${Date.now()}`,
          billingId: proRatedBill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: paymentDetails,
            notes: "Pro-rated payment - Service activated",
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    proRatedBill.status = "paid";
    proRatedBill.paymentId = payment[0]._id;
    await proRatedBill.save({ session });

    billingCycle.proRatedPaid = true;
    billingCycle.proRatedPaidAt = new Date();
    await billingCycle.save({ session });

    const fullMonthBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: false,
      status: "draft",
    });

    if (fullMonthBill) {
      fullMonthBill.status = "sent";
      await fullMonthBill.save({ session });
      await emailService.sendInvoice(user, fullMonthBill);
    }

    user.status = "active";
    if (user.billingInfo) {
      user.billingInfo.currentBill = 0;
    }
    await user.save({ session });

    if (user.mikrotik && user.mikrotik.username && user.planId) {
      try {
        await mikrotikService.applyPlanToUser(user, user.planId);
      } catch (error) {
        console.error("Error applying plan to MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Service Activated - Welcome to Mister Fyber!",
      `<p>Your internet service has been activated!</p>
       <p>Your next bill of ₱${(billingCycle.monthlyRate || 0).toFixed(2)} will be due on the 5th of next month.</p>`,
    );

    res.status(200).json({
      success: true,
      message: "Pro-rated payment confirmed. Service activated successfully!",
      data: {
        payment: payment[0],
        nextBillDueDate: fullMonthBill?.dueDate,
        nextBillAmount: fullMonthBill?.total,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== MARK BILL AS PAID ====================
export const markBillAsPaid = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId } = req.params;
    const { referenceNumber, notes } = req.body;
    const adminId = req.user?._id;

    const bill = await Billing.findById(billId).populate("userId");
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: "Bill not found" });
    }

    if (bill.status === "paid") {
      return res
        .status(400)
        .json({ success: false, message: "Bill already paid" });
    }

    const user = bill.userId as any;

    const payment = await Payment.create(
      [
        {
          userId: user._id,
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "completed",
          referenceNumber: referenceNumber || `ADMIN-${Date.now()}`,
          billingId: bill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              confirmedBy: adminId,
              confirmedAt: new Date(),
              notes: notes || "Manually marked as paid by admin",
            },
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    bill.status = "paid";
    bill.paymentId = payment[0]._id;
    await bill.save({ session });

    const billingCycle = await BillingCycle.findById(bill.billingCycleId);
    if (billingCycle) {
      billingCycle.paymentHistory = billingCycle.paymentHistory || [];
      billingCycle.paymentHistory.push({
        billingId: bill._id,
        amount: bill.total,
        paidAt: new Date(),
      });
      await billingCycle.save({ session });
    }

    if (user.billingInfo) {
      user.billingInfo.currentBill = 0;
      await user.save({ session });
    }

    if (user.status === "suspended") {
      user.status = "active";
      await user.save({ session });

      if (user.mikrotik?.username && user.planId) {
        try {
          await mikrotikService.applyPlanToUser(user, user.planId);
        } catch (error) {
          console.error("Error reconnecting MikroTik:", error);
        }
      }
    }

    await session.commitTransaction();
    await emailService.sendPaymentConfirmation(user, payment[0], bill);

    res.status(200).json({
      success: true,
      message: `Bill ${bill.invoiceNumber} marked as paid successfully`,
      data: { payment: payment[0], bill },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== AUTO-GENERATE MONTHLY BILLS ====================
export const autoGenerateMonthlyBills = async () => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoGenerateBills) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const billingCycles = await BillingCycle.find({
      status: "active",
      proRatedPaid: true,
      nextBillingDate: { $lte: today },
    }).populate("userId planId");

    console.log(
      `🔄 Auto-generating monthly bills for ${billingCycles.length} cycles`,
    );

    for (const cycle of billingCycles) {
      const user = cycle.userId as any;
      const plan = cycle.planId as any;

      if (!user || !plan) continue;

      const unpaidBills = await Billing.findOne({
        userId: user._id,
        billingCycleId: cycle._id,
        isProRated: false,
        status: { $in: ["sent", "overdue"] },
      });

      if (unpaidBills) {
        const daysOverdue = Math.ceil(
          (today.getTime() - unpaidBills.dueDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (
          daysOverdue >= settings.gracePeriodDays &&
          user.status !== "suspended"
        ) {
          user.status = "suspended";
          await user.save();
          console.log(`🔴 User ${user.email} suspended due to non-payment`);
        }
        continue;
      }

      const billingStart = new Date(cycle.nextBillingDate);
      billingStart.setHours(0, 0, 0, 0);

      const billingEnd = new Date(billingStart);
      billingEnd.setMonth(billingEnd.getMonth() + 1);
      billingEnd.setDate(0);
      billingEnd.setHours(23, 59, 59, 999);

      const dueDate = new Date(billingStart);
      dueDate.setDate(settings.dueDateDaysAfterPeriod || 5);
      dueDate.setHours(23, 59, 59, 999);

      const existingBill = await Billing.findOne({
        userId: user._id,
        billingCycleId: cycle._id,
        "billingPeriod.start": billingStart,
      });

      if (!existingBill) {
        const bill = await Billing.create({
          userId: user._id,
          billingCycleId: cycle._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: { start: billingStart, end: billingEnd },
          dueDate: dueDate,
          items: [
            {
              description: `Monthly Subscription - ${billingStart.toLocaleDateString()} to ${billingEnd.toLocaleDateString()}`,
              quantity: 1,
              rate: plan.price,
              amount: plan.price,
            },
          ],
          subtotal: plan.price,
          total: plan.price,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
        });

        const nextDate = new Date(billingStart);
        nextDate.setMonth(nextDate.getMonth() + 1);
        nextDate.setDate(1);
        cycle.nextBillingDate = nextDate;
        await cycle.save();

        try {
          await emailService.sendInvoice(user, bill);
        } catch (emailError) {
          console.error("Failed to send invoice email:", emailError);
        }

        console.log(`✅ Generated bill for ${user.email}: ₱${plan.price}`);
      }
    }
  } catch (error) {
    console.error("Auto-generate monthly bills error:", error);
  }
};

// ==================== AUTO SUSPEND OVERDUE ====================
export const autoSuspendOverdue = async () => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoSuspendOnNonPayment) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const gracePeriodDate = new Date(today);
    gracePeriodDate.setDate(
      gracePeriodDate.getDate() - settings.gracePeriodDays,
    );

    const overdueBills = await Billing.find({
      status: "overdue",
      dueDate: { $lt: gracePeriodDate },
      suspensionNotified: { $ne: true },
    }).populate("userId");

    for (const bill of overdueBills) {
      const user = bill.userId as any;
      if (!user) continue;

      bill.suspensionNotified = true;
      await bill.save();

      if (user.status === "active") {
        user.status = "suspended";
        await user.save();

        if (user.mikrotik?.username) {
          try {
            await mikrotikService.disablePPPoEUser(user);
          } catch (error) {
            console.error("Error disabling user in MikroTik:", error);
          }
        }

        console.log(`🔴 Suspended ${user.email} for non-payment`);
      }
    }
  } catch (error) {
    console.error("Auto-suspend overdue error:", error);
  }
};

// ==================== GET ALL PENDING PRO-RATED BILLS ====================
export const getPendingProRatedBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pendingBills = await Billing.find({
      isProRated: true,
      status: "sent",
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingBills,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET BILLING SUMMARY FOR ADMIN ====================
export const getBillingSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const totalActiveCycles = await BillingCycle.countDocuments({
      status: "active",
      proRatedPaid: true,
    });
    const pendingProRated = await Billing.countDocuments({
      isProRated: true,
      status: "sent",
    });
    const overdueBills = await Billing.countDocuments({ status: "overdue" });

    const outstandingResult = await Billing.aggregate([
      { $match: { status: { $in: ["sent", "overdue"] } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]);

    const totalOutstanding = outstandingResult[0]?.total || 0;

    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const monthlyRevenue = await Payment.aggregate([
      { $match: { status: "completed", paidAt: { $gte: firstOfMonth } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        activeSubscriptions: totalActiveCycles,
        pendingActivations: pendingProRated,
        overdueAccounts: overdueBills,
        totalOutstanding: totalOutstanding,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET USER'S CURRENT BILLING STATUS ====================
export const getUserCurrentBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    }).populate("planId");

    if (!billingCycle) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No active billing cycle",
      });
    }

    if (!billingCycle.proRatedPaid) {
      const proRatedBill = await Billing.findOne({
        userId,
        billingCycleId: billingCycle._id,
        isProRated: true,
      });

      return res.status(200).json({
        success: true,
        data: {
          billingCycle,
          currentBill: proRatedBill,
          needsFirstPayment: true,
          firstBillAmount: proRatedBill?.total,
          firstBillDueDate: proRatedBill?.dueDate,
          hasOverdue: false,
          overdueCount: 0,
          overdueAmount: 0,
          upcomingBills: [],
          isPendingPayment: false,
        },
      });
    }

    const currentBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: false,
      status: { $in: ["sent", "overdue"] },
    }).sort({ dueDate: 1 });

    const upcomingBills = await Billing.find({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: false,
      status: "draft",
    }).sort({ dueDate: 1 });

    const hasOverdue = currentBill?.status === "overdue";

    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentBill,
        upcomingBills,
        hasOverdue,
        overdueCount: hasOverdue ? 1 : 0,
        overdueAmount: hasOverdue ? currentBill?.total || 0 : 0,
        needsFirstPayment: false,
        isPendingPayment: false,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL BILLING CYCLES ====================
export const getAllBillingCycles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cycles = await BillingCycle.find()
      .populate("userId", "firstName lastName email username status")
      .populate("planId", "name price")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: cycles });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL BILLS ====================
export const getAllBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { status, type } = req.query;
    let query: any = {};

    if (status) query.status = status;
    if (type === "pro-rated") query.isProRated = true;
    if (type === "monthly") query.isProRated = false;

    const bills = await Billing.find(query)
      .populate("userId", "firstName lastName email username")
      .populate("billingCycleId")
      .sort({ dueDate: -1 });

    res.status(200).json({ success: true, data: bills });
  } catch (error) {
    next(error);
  }
};

// ==================== STOP BILLING ====================
export const stopBilling = async (
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

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    });

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No active billing cycle found",
      });
    }

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

    billingCycle.status = "cancelled";
    billingCycle.billingEndDate = new Date();
    await billingCycle.save();

    res.status(200).json({
      success: true,
      message: `Billing stopped for ${user.firstName} ${user.lastName}`,
      data: { billingCycle },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== RECONNECT SERVICE ====================
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
      await billingCycle.save();
    }

    if (user.mikrotik?.username && user.planId) {
      try {
        await mikrotikService.applyPlanToUser(user, user.planId);
      } catch (error) {
        console.error("Error reconnecting MikroTik:", error);
      }
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

// ==================== DISCONNECT SERVICE ====================
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

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error("Error disabling user in MikroTik:", error);
      }
    }

    res.status(200).json({
      success: true,
      message: `Service disconnected for ${user.firstName} ${user.lastName}`,
    });
  } catch (error) {
    next(error);
  }
};
