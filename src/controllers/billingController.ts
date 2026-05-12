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

type AuthRequest = Request & { user?: any };

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

// ==================== GET BILLING SETTINGS ====================
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
        dueDateDaysAfterPeriod: 5,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
        freeDays: 1,
      });
    }
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ==================== UPDATE BILLING SETTINGS ====================
export const updateBillingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const settings = await BillingSettings.findOneAndUpdate({}, req.body, {
      new: true,
      upsert: true,
    });
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

// ==================== AUTO SEND REMINDERS ====================
export const autoSendReminders = async (req?: AuthRequest, res?: Response) => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoSendReminders) {
      console.log("Auto-send reminders is disabled");
      if (res) {
        return res
          .status(200)
          .json({ success: true, message: "Auto-send reminders is disabled" });
      }
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminderDays = settings.reminderDays || [7, 3, 1];
    let remindersSent = 0;

    for (const days of reminderDays) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + days);
      targetDate.setHours(23, 59, 59, 999);

      let reminderField: string;
      if (days === 7) reminderField = "reminder7DaySent";
      else if (days === 3) reminderField = "reminder3DaySent";
      else if (days === 1) reminderField = "reminder1DaySent";
      else continue;

      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const bills = await Billing.find({
        status: "sent",
        dueDate: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
        [reminderField]: { $ne: true },
      }).populate("userId");

      for (const bill of bills) {
        const user = bill.userId as any;
        if (user && user.email) {
          await emailService.sendEmail(
            user.email,
            `Payment Reminder - Bill ${bill.invoiceNumber}`,
            `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
             <p>Your bill of ₱${bill.total.toFixed(2)} is due in ${days} day(s).</p>
             <p>Due Date: ${bill.dueDate.toLocaleDateString()}</p>
             <p>Please make your payment on time to avoid service interruption.</p>
             <p>Thank you,<br>Mister Fyber Team</p>`,
          );

          if (days === 7) (bill as any).reminder7DaySent = true;
          else if (days === 3) (bill as any).reminder3DaySent = true;
          else if (days === 1) (bill as any).reminder1DaySent = true;
          await bill.save();
          remindersSent++;

          console.log(
            `📧 Sent ${days}-day reminder for bill ${bill.invoiceNumber} to ${user.email}`,
          );
        }
      }
    }

    if (res) {
      res
        .status(200)
        .json({ success: true, message: `Sent ${remindersSent} reminders` });
    }
  } catch (error) {
    console.error("Auto-send reminders error:", error);
    if (res) {
      res
        .status(500)
        .json({ success: false, message: "Failed to send reminders" });
    }
  }
};

// ==================== START BILLING (PRO-RATED with FREE DAY) ====================
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

    const settings = await BillingSettings.findOne();
    const freeDays = settings?.freeDays || 1;

    const plan = user.planId as any;
    const monthlyRate = plan.price;

    let installationDate = startDate ? new Date(startDate) : new Date();
    installationDate.setHours(0, 0, 0, 0);

    const existingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["active", "paused", "pending_activation"] },
    });

    if (existingCycle) {
      return res.status(400).json({
        success: false,
        message: "User already has a billing cycle",
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
    const totalDaysInPeriod = daysInMonth - installationDay + 1;

    const actualBillableDays = Math.max(0, totalDaysInPeriod - freeDays);
    const dailyRate = monthlyRate / daysInMonth;
    let proRatedAmount = Math.round(dailyRate * actualBillableDays * 100) / 100;

    if (customAmount) {
      proRatedAmount = customAmount;
    }

    const proRatedDueDate = new Date(installationDate);
    proRatedDueDate.setDate(proRatedDueDate.getDate() + 5);
    proRatedDueDate.setHours(23, 59, 59, 999);

    const nextBillingDate = new Date(installationDate);
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
          status: "pending_activation",
          monthlyRate,
          currentProRatedAmount: proRatedAmount,
          proRatedPaid: false,
          freeDays: freeDays,
          actualBillableDays: actualBillableDays,
          manualBillStart: false,
        },
      ],
      { session },
    );

    const proRatedBillDescription =
      freeDays === 1
        ? `Pro-rated payment from ${installationDate.toLocaleDateString()} to ${lastDayOfMonth.toLocaleDateString()} (${totalDaysInPeriod} days total, ${freeDays} day free, ${actualBillableDays} days billable)`
        : `Pro-rated payment from ${installationDate.toLocaleDateString()} to ${lastDayOfMonth.toLocaleDateString()} (${actualBillableDays} days)`;

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
          dueDate: proRatedDueDate,
          items: [
            {
              description: proRatedBillDescription,
              quantity: actualBillableDays,
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
          proRatedDays: actualBillableDays,
          notes:
            notes ||
            `Pro-rated billing - ${freeDays} day(s) free, due in 5 days`,
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
      message: `Billing started. Pro-rated amount of ₱${proRatedAmount.toFixed(2)} (${freeDays} day(s) free) is due by ${proRatedDueDate.toLocaleDateString()}. Monthly billing will start when admin activates the service.`,
      data: {
        billingCycle: billingCycle[0],
        proRatedBill: proRatedBill[0],
        proRatedAmount,
        actualBillableDays,
        freeDays,
        totalDaysInPeriod,
        proRatedDueDate: proRatedDueDate,
        nextBillingDate: nextBillingDate,
        requiresProRatedPayment: true,
        manualBillStartRequired: true,
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
      status: "pending_activation",
    }).populate("planId");

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No pending billing cycle found",
      });
    }

    if (billingCycle.proRatedPaid) {
      return res.status(400).json({
        success: false,
        message: "Pro-rated payment already confirmed",
      });
    }

    const proRatedBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: true,
      status: "pending_confirmation",
    });

    if (!proRatedBill) {
      return res.status(404).json({
        success: false,
        message: "Pro-rated bill not found or not pending confirmation",
      });
    }

    proRatedBill.status = "paid";
    await proRatedBill.save({ session });

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
            notes: "Pro-rated payment confirmed",
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    proRatedBill.paymentId = payment[0]._id;
    await proRatedBill.save({ session });

    billingCycle.proRatedPaid = true;
    billingCycle.proRatedPaidAt = new Date();
    billingCycle.status = "active";
    await billingCycle.save({ session });

    user.status = "active";
    await user.save({ session });

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Pro-rated Payment Confirmed - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your pro-rated payment of ₱${proRatedBill.total.toFixed(2)} has been confirmed.</p>
       <p>Your billing cycle is now active. Your monthly bills will be generated automatically.</p>
       <p>Thank you for choosing Mister Fyber!</p>`,
    );

    res.status(200).json({
      success: true,
      message: "Pro-rated payment confirmed. Billing cycle is now active.",
      data: {
        payment: payment[0],
        billingCycle: billingCycle,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== START MONTHLY BILLING ====================
export const startMonthlyBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.body;

    const user = await User.findById(userId).populate("planId");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "pending_activation",
      proRatedPaid: true,
    }).populate("planId");

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message:
          "No pending billing cycle found or pro-rated payment not confirmed",
      });
    }

    if (billingCycle.manualBillStart) {
      return res.status(400).json({
        success: false,
        message: "Monthly billing has already been started for this user",
      });
    }

    const today = new Date();
    let billingStart = new Date(today);
    billingStart.setDate(1);
    billingStart.setHours(0, 0, 0, 0);

    const billingEnd = new Date(billingStart);
    billingEnd.setMonth(billingEnd.getMonth() + 1);
    billingEnd.setDate(0);
    billingEnd.setHours(23, 59, 59, 999);

    const dueDate = new Date(billingStart);
    dueDate.setDate(5);
    dueDate.setHours(23, 59, 59, 999);

    const plan = billingCycle.planId as any;
    const monthlyRate = plan.price;

    const firstMonthlyBill = await Billing.create(
      [
        {
          userId,
          billingCycleId: billingCycle._id,
          invoiceNumber: generateInvoiceNumber(),
          billingPeriod: {
            start: billingStart,
            end: billingEnd,
          },
          dueDate: dueDate,
          items: [
            {
              description: `Monthly Subscription - ${billingStart.toLocaleDateString()} to ${billingEnd.toLocaleDateString()}`,
              quantity: 1,
              rate: monthlyRate,
              amount: monthlyRate,
            },
          ],
          subtotal: monthlyRate,
          tax: 0,
          discount: 0,
          total: monthlyRate,
          status: "sent",
          isProRated: false,
          proRatedDays: 0,
          notes: "First monthly bill - Service activated",
        },
      ],
      { session },
    );

    billingCycle.status = "active";
    billingCycle.manualBillStart = true;
    billingCycle.manuallyStartedAt = new Date();

    const nextDate = new Date(billingStart);
    nextDate.setMonth(nextDate.getMonth() + 1);
    nextDate.setDate(1);
    billingCycle.nextBillingDate = nextDate;
    await billingCycle.save({ session });

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
      "Your Internet Service is Now Active - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your internet service has been activated!</p>
       <p>Your first monthly bill of ₱${monthlyRate.toFixed(2)} for period ${billingStart.toLocaleDateString()} to ${billingEnd.toLocaleDateString()} is due on ${dueDate.toLocaleDateString()}.</p>
       <p>You can view and pay your bill in your customer portal.</p>
       <p>Thank you for choosing Mister Fyber!</p>`,
    );

    await emailService.sendInvoice(user, firstMonthlyBill[0]);

    res.status(200).json({
      success: true,
      message: "Monthly billing started successfully. Service activated.",
      data: {
        firstMonthlyBill: firstMonthlyBill[0],
        nextBillDueDate: dueDate,
        nextBillAmount: monthlyRate,
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
        .json({ success: false, message: "Bill is already paid" });
    }

    const user = bill.userId as any;

    const existingPayment = await Payment.findOne({
      billingId: bill._id,
      status: "completed",
    });

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already exists for this bill",
        data: { payment: existingPayment },
      });
    }

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

      if (bill.isProRated && !billingCycle.proRatedPaid) {
        billingCycle.proRatedPaid = true;
        billingCycle.proRatedPaidAt = new Date();
        if (billingCycle.status === "pending_activation") {
          billingCycle.status = "active";
        }
      }

      await billingCycle.save({ session });
    }

    if (user.status === "pending_activation") {
      user.status = "active";
      await user.save({ session });
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

// ==================== SUBMIT PRO-RATED PAYMENT ====================
export const submitProRatedPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId, referenceNumber, notes } = req.body;
    const userId = req.user?._id;

    const bill = await Billing.findOne({
      _id: billId,
      userId,
      isProRated: true,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Pro-rated bill not found",
      });
    }

    if (bill.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "This bill has already been paid",
      });
    }

    if (bill.status === "pending_confirmation") {
      return res.status(400).json({
        success: false,
        message: "Payment already submitted and pending admin confirmation",
      });
    }

    const existingPendingPayment = await Payment.findOne({
      billingId: bill._id,
      status: "pending",
    });

    if (existingPendingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already pending confirmation. Please wait for admin.",
      });
    }

    bill.status = "pending_confirmation";
    await bill.save({ session });

    const payment = await Payment.create(
      [
        {
          userId,
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "pending",
          referenceNumber: referenceNumber || `PAY-${Date.now()}`,
          billingId: bill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              submittedBy: userId,
              submittedAt: new Date(),
              notes: notes || "Payment submitted by user",
            },
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    bill.paymentId = payment[0]._id;
    await bill.save({ session });

    await session.commitTransaction();

    console.log(
      `💰 Pro-rated payment submitted for user ${userId}, bill ${bill.invoiceNumber}. Awaiting admin confirmation.`,
    );

    res.status(200).json({
      success: true,
      message:
        "Payment submitted successfully! Please wait for admin confirmation.",
      data: {
        bill,
        payment: payment[0],
        status: "pending_confirmation",
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== SUBMIT MONTHLY PAYMENT ====================
export const submitMonthlyPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { billId, referenceNumber, notes } = req.body;
    const userId = req.user?._id;

    const bill = await Billing.findOne({
      _id: billId,
      userId,
      isProRated: false,
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    if (bill.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "This bill has already been paid",
      });
    }

    if (bill.status === "pending_confirmation") {
      return res.status(400).json({
        success: false,
        message: "Payment already submitted and pending admin confirmation",
      });
    }

    const existingPendingPayment = await Payment.findOne({
      billingId: bill._id,
      status: "pending",
    });

    if (existingPendingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already pending confirmation. Please wait for admin.",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const billStartDate = new Date(bill.billingPeriod.start);
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const billMonth = billStartDate.getMonth();
    const billYear = billStartDate.getFullYear();

    const isCurrentMonth =
      billYear === currentYear && billMonth === currentMonth;

    if (!isCurrentMonth) {
      return res.status(400).json({
        success: false,
        message:
          "You can only pay for the current month's bill. Please contact admin for older bills.",
      });
    }

    bill.status = "pending_confirmation";
    await bill.save({ session });

    const payment = await Payment.create(
      [
        {
          userId,
          amount: bill.total,
          paymentMethod: "manual",
          paymentType: "subscription",
          status: "pending",
          referenceNumber: referenceNumber || `PAY-${Date.now()}`,
          billingId: bill._id,
          paymentDetails: {
            gateway: "manual",
            gatewayResponse: {
              submittedBy: userId,
              submittedAt: new Date(),
              notes: notes || "Payment submitted by user",
            },
          },
          paidAt: new Date(),
        },
      ],
      { session },
    );

    bill.paymentId = payment[0]._id;
    await bill.save({ session });

    await session.commitTransaction();

    console.log(
      `💰 Monthly payment submitted for user ${userId}, bill ${bill.invoiceNumber}. Awaiting admin confirmation.`,
    );

    res.status(200).json({
      success: true,
      message:
        "Payment submitted successfully! Please wait for admin confirmation.",
      data: {
        bill,
        payment: payment[0],
        status: "pending_confirmation",
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== AUTO-GENERATE MONTHLY BILLS ====================
export const autoGenerateMonthlyBills = async (
  req?: AuthRequest,
  res?: Response,
) => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoGenerateBills) {
      console.log("Auto-generate bills is disabled");
      if (res) {
        return res
          .status(200)
          .json({ success: true, message: "Auto-generate bills is disabled" });
      }
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const billingCycles = await BillingCycle.find({
      status: "active",
      proRatedPaid: true,
      manualBillStart: true,
      nextBillingDate: { $lte: today },
    }).populate("userId planId");

    console.log(
      `🔄 Auto-generating monthly bills for ${billingCycles.length} cycles`,
    );

    let generatedCount = 0;

    for (const cycle of billingCycles) {
      const user = cycle.userId as any;
      const plan = cycle.planId as any;

      if (!user || !plan) continue;

      const billingStart = new Date(cycle.nextBillingDate);
      billingStart.setHours(0, 0, 0, 0);

      const billingEnd = new Date(billingStart);
      billingEnd.setMonth(billingEnd.getMonth() + 1);
      billingEnd.setDate(0);
      billingEnd.setHours(23, 59, 59, 999);

      const dueDate = new Date(billingStart);
      dueDate.setDate(settings.dueDateDaysAfterPeriod || 5);
      dueDate.setHours(23, 59, 59, 999);

      const existingBillForThisPeriod = await Billing.findOne({
        userId: user._id,
        billingCycleId: cycle._id,
        isProRated: false,
        "billingPeriod.start": billingStart,
        "billingPeriod.end": billingEnd,
      });

      if (existingBillForThisPeriod) {
        console.log(
          `⏭️ Bill already exists for period ${billingStart.toLocaleDateString()} to ${billingEnd.toLocaleDateString()} for user ${user.email}`,
        );

        if (existingBillForThisPeriod.status === "overdue") {
          const daysOverdue = Math.ceil(
            (today.getTime() - existingBillForThisPeriod.dueDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );

          if (
            daysOverdue >= (settings.gracePeriodDays || 5) &&
            user.status !== "suspended"
          ) {
            user.status = "suspended";
            await user.save();
            console.log(
              `🔴 User ${user.email} suspended due to non-payment of bill ${existingBillForThisPeriod.invoiceNumber}`,
            );
          }
        }
        continue;
      }

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
        console.log(
          `📧 Sent invoice email for ${bill.invoiceNumber} to ${user.email}`,
        );
      } catch (emailError) {
        console.error("Failed to send invoice email:", emailError);
      }

      generatedCount++;
      console.log(
        `✅ Generated bill for ${user.email}: ₱${plan.price} for period ${billingStart.toLocaleDateString()} to ${billingEnd.toLocaleDateString()}`,
      );
    }

    if (res) {
      res
        .status(200)
        .json({ success: true, message: `Generated ${generatedCount} bills` });
    }
  } catch (error) {
    console.error("Auto-generate monthly bills error:", error);
    if (res) {
      res
        .status(500)
        .json({ success: false, message: "Failed to generate bills" });
    }
  }
};

// ==================== AUTO SUSPEND OVERDUE ====================
export const autoSuspendOverdue = async (req?: AuthRequest, res?: Response) => {
  try {
    const settings = await BillingSettings.findOne();
    if (!settings || !settings.autoSuspendOnNonPayment) {
      console.log("Auto-suspend is disabled");
      if (res) {
        return res
          .status(200)
          .json({ success: true, message: "Auto-suspend is disabled" });
      }
      return;
    }

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

    let suspendedCount = 0;

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

        suspendedCount++;
        console.log(`🔴 Suspended ${user.email} for non-payment`);
      }
    }

    if (res) {
      res
        .status(200)
        .json({ success: true, message: `Suspended ${suspendedCount} users` });
    }
  } catch (error) {
    console.error("Auto-suspend overdue error:", error);
    if (res) {
      res
        .status(500)
        .json({ success: false, message: "Failed to suspend users" });
    }
  }
};

// ==================== GET PENDING PRO-RATED PAYMENTS ====================
export const getPendingProRatedBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pendingBills = await Billing.find({
      isProRated: true,
      status: "pending_confirmation",
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

// ==================== GET PENDING ACTIVATIONS ====================
export const getPendingActivations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pendingCycles = await BillingCycle.find({
      status: "pending_activation",
      proRatedPaid: true,
      manualBillStart: false,
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .populate("planId", "name price")
      .sort({ proRatedPaidAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingCycles,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL UNPAID PRO-RATED BILLS ====================
export const getUnpaidProRatedBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const unpaidBills = await Billing.find({
      isProRated: true,
      status: "sent",
    })
      .populate("userId", "firstName lastName email username phoneNumber")
      .sort({ dueDate: 1 });

    res.status(200).json({
      success: true,
      data: unpaidBills,
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
      manualBillStart: true,
    });

    const totalPausedCycles = await BillingCycle.countDocuments({
      status: "paused",
    });

    const pendingProRated = await Billing.countDocuments({
      isProRated: true,
      status: "pending_confirmation",
    });

    const pendingActivations = await BillingCycle.countDocuments({
      status: "pending_activation",
      proRatedPaid: true,
      manualBillStart: false,
    });

    const overdueBills = await Billing.countDocuments({ status: "overdue" });

    const unpaidProRated = await Billing.countDocuments({
      isProRated: true,
      status: "sent",
    });

    const outstandingResult = await Billing.aggregate([
      {
        $match: {
          status: { $in: ["sent", "overdue", "pending_confirmation"] },
        },
      },
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
        pausedSubscriptions: totalPausedCycles,
        pendingProRated: pendingProRated,
        pendingActivations: pendingActivations,
        overdueAccounts: overdueBills,
        totalOutstanding: totalOutstanding,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
        unpaidProRated: unpaidProRated,
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

    console.log(`🔍 Getting current billing for user: ${userId}`);

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["active", "pending_activation", "paused"] },
    }).populate("planId");

    if (!billingCycle) {
      console.log(`No billing cycle found for user ${userId}`);
      return res.status(200).json({
        success: true,
        data: null,
        message: "No active billing cycle",
      });
    }

    const proRatedBill = await Billing.findOne({
      userId,
      billingCycleId: billingCycle._id,
      isProRated: true,
    });

    const isProRatedBillPaid = proRatedBill?.status === "paid";
    const isProRatedPaid =
      billingCycle.proRatedPaid === true || isProRatedBillPaid;

    console.log(`Pro-rated bill found: ${proRatedBill ? "YES" : "NO"}`);
    if (proRatedBill) {
      console.log(
        `Pro-rated bill amount: ₱${proRatedBill.total}, status: ${proRatedBill.status}`,
      );
    }
    console.log(`Is pro-rated paid: ${isProRatedPaid}`);

    if (proRatedBill && !isProRatedPaid) {
      const isPendingConfirmation =
        proRatedBill.status === "pending_confirmation";
      const isOverdue =
        proRatedBill.status === "overdue" ||
        new Date(proRatedBill.dueDate) < new Date();

      console.log(`RETURNING PRO-RATED BILL: ₱${proRatedBill.total}`);

      return res.status(200).json({
        success: true,
        data: {
          billingCycle,
          currentBill: proRatedBill,
          needsFirstPayment: !isPendingConfirmation && !isOverdue,
          isPendingPayment: isPendingConfirmation,
          firstBillAmount: proRatedBill.total,
          firstBillDueDate: proRatedBill.dueDate,
          hasOverdue: isOverdue,
          overdueCount: isOverdue ? 1 : 0,
          overdueAmount: isOverdue ? proRatedBill.total : 0,
          upcomingBills: [],
          waitingForAdminActivation: false,
          freeDays: billingCycle.freeDays,
          actualBillableDays: billingCycle.actualBillableDays,
          isPaused: billingCycle.status === "paused",
        },
      });
    }

    if (isProRatedPaid) {
      console.log(`Pro-rated is paid, showing monthly bills`);

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

      return res.status(200).json({
        success: true,
        data: {
          billingCycle,
          currentBill: currentBill || null,
          upcomingBills,
          hasOverdue: hasOverdue || false,
          overdueCount: hasOverdue ? 1 : 0,
          overdueAmount: hasOverdue ? currentBill?.total || 0 : 0,
          needsFirstPayment: false,
          isPendingPayment: false,
          waitingForAdminActivation: false,
          freeDays: billingCycle.freeDays,
          actualBillableDays: billingCycle.actualBillableDays,
          isActive: true,
          proRatedPaid: true,
          isPaused: billingCycle.status === "paused",
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        billingCycle,
        currentBill: null,
        upcomingBills: [],
        hasOverdue: false,
        overdueCount: 0,
        overdueAmount: 0,
        needsFirstPayment: false,
        isPendingPayment: false,
        waitingForAdminActivation: false,
        freeDays: billingCycle.freeDays,
        actualBillableDays: billingCycle.actualBillableDays,
        isPaused: billingCycle.status === "paused",
      },
    });
  } catch (error) {
    console.error("Error in getUserCurrentBilling:", error);
    next(error);
  }
};

// ==================== GET USER BILLING HISTORY ====================
export const getUserBillingHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?._id;
    const { limit = 50, page = 1 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const bills = await Billing.find({
      userId,
      status: "paid",
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("billingCycleId");

    const total = await Billing.countDocuments({
      userId,
      status: "paid",
    });

    const history = bills.map((bill) => ({
      _id: bill._id,
      invoiceNumber: bill.invoiceNumber,
      billingPeriod: bill.billingPeriod,
      dueDate: bill.dueDate,
      total: bill.total,
      status: bill.status,
      isProRated: bill.isProRated,
      proRatedDays: bill.proRatedDays,
      paidDate: bill.updatedAt,
      items: bill.items,
    }));

    res.status(200).json({
      success: true,
      data: {
        history,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
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
        message: "No active billing cycle found to stop",
      });
    }

    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
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
    await billingCycle.save({ session });

    user.status = "inactive";
    await user.save({ session });

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error("Error disabling user in MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Your Billing Has Been Stopped - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your billing cycle has been stopped.</p>
       <p>Reason: ${reason || "Admin action"}</p>
       <p>If you have any questions, please contact our support team.</p>
       <p>Thank you,<br>Mister Fyber Team</p>`,
    );

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

// ==================== PAUSE BILLING (FOR VACATION) ====================
export const pauseBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, reason, pauseUntilDate } = req.body;

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
        message: "No active billing cycle found to pause",
      });
    }

    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue", "pending_confirmation"] },
    });

    if (unpaidBills) {
      return res.status(400).json({
        success: false,
        message: "User has unpaid bills. Please settle before pausing.",
      });
    }

    const pauseDate = new Date();
    billingCycle.status = "paused";
    billingCycle.pausedAt = pauseDate;
    billingCycle.pauseReason = reason || "User requested pause (vacation)";
    billingCycle.pauseUntil = pauseUntilDate
      ? new Date(pauseUntilDate)
      : undefined;
    await billingCycle.save({ session });

    user.status = "paused";
    await user.save({ session });

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error("Error disabling user in MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Your Service Has Been Paused - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your internet service has been paused as requested.</p>
       <p>Reason: ${reason || "Vacation/Requested pause"}</p>
       ${pauseUntilDate ? `<p>Your service will automatically resume on: ${new Date(pauseUntilDate).toLocaleDateString()}</p>` : ""}
       <p>No bills will be generated during the pause period.</p>
       <p>To resume your service, please contact our support team or use the resume button in your dashboard.</p>
       <p>Thank you,<br>Mister Fyber Team</p>`,
    );

    res.status(200).json({
      success: true,
      message: `Service paused for ${user.firstName} ${user.lastName}. No bills will be generated during pause.`,
      data: { billingCycle, pauseDate, pauseUntil: pauseUntilDate },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== RESUME BILLING (AFTER PAUSE) - FIXED ====================
export const resumeBilling = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId } = req.body;

    console.log(`🔄 Resuming billing for user: ${userId}`);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const user = await User.findById(userId).populate("planId");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "paused",
    });

    if (!billingCycle) {
      return res.status(404).json({
        success: false,
        message: "No paused billing cycle found for this user",
      });
    }

    const resumeDate = new Date();
    const nextBillingDate = new Date(resumeDate);
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    nextBillingDate.setDate(1);
    nextBillingDate.setHours(0, 0, 0, 0);

    // Update billing cycle
    billingCycle.status = "active";
    billingCycle.resumedAt = resumeDate;
    billingCycle.nextBillingDate = nextBillingDate;
    billingCycle.pausedAt = undefined;
    billingCycle.pauseReason = undefined;
    billingCycle.pauseUntil = undefined;
    await billingCycle.save();

    // Update user status
    user.status = "active";
    await user.save();

    // Re-apply MikroTik plan if configured
    if (user.mikrotik && user.mikrotik.username && user.planId) {
      try {
        await mikrotikService.applyPlanToUser(user, user.planId);
        console.log(`✅ MikroTik user ${user.mikrotik.username} re-enabled`);
      } catch (error) {
        console.error("Error enabling user in MikroTik:", error);
      }
    }

    // Send notification email
    await emailService.sendEmail(
      user.email,
      "Your Service Has Been Resumed - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your internet service has been resumed.</p>
       <p>Your next billing date is: ${nextBillingDate.toLocaleDateString()}</p>
       <p>Thank you for choosing Mister Fyber!</p>`,
    );

    res.status(200).json({
      success: true,
      message: `Service resumed for ${user.firstName} ${user.lastName}`,
      data: {
        billingCycle,
        resumeDate,
        nextBillingDate,
        userStatus: user.status,
      },
    });
  } catch (error) {
    console.error("Error in resumeBilling:", error);
    next(error);
  }
};

// ==================== RECONNECT SERVICE ====================
export const reconnectClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

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

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: { $in: ["paused", "cancelled"] },
    });

    if (billingCycle && billingCycle.status === "paused") {
      billingCycle.status = "active";
      const resumeDate = new Date();
      const nextBillingDate = new Date(resumeDate);
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
      nextBillingDate.setDate(1);
      billingCycle.nextBillingDate = nextBillingDate;
      billingCycle.resumedAt = resumeDate;
      billingCycle.pausedAt = undefined;
      billingCycle.pauseReason = undefined;
      billingCycle.pauseUntil = undefined;
      await billingCycle.save({ session });
    }

    user.status = "active";
    await user.save({ session });

    if (user.mikrotik?.username && user.planId) {
      try {
        await mikrotikService.applyPlanToUser(user, user.planId);
      } catch (error) {
        console.error("Error reconnecting MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Your Service Has Been Reconnected - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your internet service has been reconnected.</p>
       <p>Thank you for choosing Mister Fyber!</p>`,
    );

    res.status(200).json({
      success: true,
      message: `Service reconnected for ${user.firstName} ${user.lastName}`,
      data: { userId: user._id, status: "active" },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== DISCONNECT SERVICE ====================
export const disconnectClient = async (
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

    const unpaidBills = await Billing.findOne({
      userId,
      status: { $in: ["sent", "overdue"] },
    });

    if (unpaidBills) {
      return res.status(400).json({
        success: false,
        message: "User has unpaid bills. Please settle before disconnecting.",
      });
    }

    const billingCycle = await BillingCycle.findOne({
      userId,
      status: "active",
    });

    if (billingCycle) {
      billingCycle.status = "paused";
      billingCycle.serviceSuspendedAt = new Date();
      billingCycle.disconnectReason = reason || "Admin initiated disconnect";
      await billingCycle.save({ session });
    }

    user.status = "suspended";
    await user.save({ session });

    if (user.mikrotik?.username) {
      try {
        await mikrotikService.disablePPPoEUser(user);
      } catch (error) {
        console.error("Error disabling user in MikroTik:", error);
      }
    }

    await session.commitTransaction();

    await emailService.sendEmail(
      user.email,
      "Your Service Has Been Disconnected - Mister Fyber",
      `<p>Dear ${user.firstName || user.username} ${user.lastName || ""},</p>
       <p>Your internet service has been disconnected.</p>
       <p>Reason: ${reason || "Admin action"}</p>
       <p>To have your service reconnected, please contact our support team and settle any outstanding balance.</p>
       <p>Thank you,<br>Mister Fyber Team</p>`,
    );

    res.status(200).json({
      success: true,
      message: `Service disconnected for ${user.firstName} ${user.lastName}`,
      data: { userId: user._id, status: "suspended", disconnectReason: reason },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
