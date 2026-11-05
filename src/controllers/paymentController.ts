// backend/src/controllers/paymentController.ts - OPTIMIZED

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment";
import User from "../models/User";
import Application from "../models/Application";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import Invoice from "../models/Invoice";
import Plan from "../models/Plan";
import emailService, {
  getLocationFromEntity,
  getCollectionEmailByLocation,
} from "../services/emailService";
import mikrotikService from "../services/mikrotikService";
import paymentService from "../services/paymentService";
import { generateInvoicePDF } from "../services/pdfService";
import fs from "fs";
import path from "path";

interface AuthRequest extends Request {
  user?: any;
  query: any;
  params: any;
  body: any;
}

// ==================== TYPED HELPERS FOR AGGREGATION ====================
interface TypeStat {
  _id: string;
  total: number;
  count: number;
}

interface AmountStat {
  _id: null;
  total: number;
  count: number;
}

// ==================== WILCONNECT BUILDINGS ====================
const WILCONNECT_BUILDINGS = ["el pueblo", "vitalez", "newport"];
const WORKSELPUEBLO_EMAIL = "workselpueblo@fyberblizz.com";

// ==================== HELPERS ====================

/**
 * Determine the correct payment type from a billing document.
 */
function determinePaymentType(billing: any, requestedType?: string): string {
  if (
    requestedType &&
    ["subscription", "installation", "pro_rated", "others"].includes(
      requestedType,
    )
  ) {
    return requestedType;
  }
  if (!billing) return "subscription";
  if (billing.isInstallationBill === true) return "installation";
  if (billing.installationFee && billing.installationFee > 0)
    return "installation";
  if (billing.isProRated === true) return "pro_rated";
  return "subscription";
}

/**
 * Apply the paymentType correction from a (populated) billing object.
 */
function correctPaymentTypeFromBilling(payment: any, billing: any) {
  if (!billing || typeof billing !== "object") return;
  if (billing.isInstallationBill === true) {
    payment.paymentType = "installation";
  } else if (billing.installationFee && billing.installationFee > 0) {
    payment.paymentType = "installation";
  } else if (billing.isProRated === true) {
    payment.paymentType = "pro_rated";
  }
}

/**
 * Batch-fetch applications for a set of applicationIds and return a Map.
 */
async function batchFetchApplications(applicationIds: string[]) {
  const map = new Map<string, any>();
  if (!applicationIds.length) return map;
  const unique = Array.from(new Set(applicationIds.filter(Boolean)));
  const apps = await Application.find({ applicationId: { $in: unique } })
    .select(
      "applicationId firstName lastName email phoneNumber status serviceStatus billingStarted installationFee installationFeePaid buildingId buildingName",
    )
    .lean();
  apps.forEach((a: any) => map.set(a.applicationId, a));
  return map;
}

/**
 * Get a fully populated payment (single).
 */
async function getPopulatedPayment(paymentId: string) {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) return null;

  const payment: any = await Payment.findById(paymentId)
    .populate(
      "userId",
      "firstName lastName email username phoneNumber status mikrotik planId buildingId",
    )
    .populate(
      "billingId",
      "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod buildingId",
    )
    .lean();

  if (!payment) return null;

  const result: any = { ...payment };

  // Correct payment type from billing
  if (payment.billingId && typeof payment.billingId === "object") {
    correctPaymentTypeFromBilling(result, payment.billingId);
  }

  // Fetch application (single call)
  if (payment.applicationId) {
    const application: any = await Application.findOne({
      applicationId: payment.applicationId,
    })
      .select(
        "firstName lastName email applicationId phoneNumber status serviceStatus billingStarted installationFee installationFeePaid buildingId buildingName",
      )
      .lean();

    if (application) {
      result.application = {
        _id: application._id,
        applicationId: application.applicationId,
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phoneNumber: application.phoneNumber,
        status: application.status,
        serviceStatus: application.serviceStatus || "pending",
        billingStarted: application.billingStarted,
        installationFee: application.installationFee || 0,
        installationFeePaid: application.installationFeePaid || false,
        applicantName:
          `${application.firstName || ""} ${application.lastName || ""}`.trim(),
        buildingId: application.buildingId,
        buildingName: application.buildingName || "",
      };
      result.applicationId = application.applicationId;
      if (!result.buildingId && application.buildingId)
        result.buildingId = application.buildingId;
      if (!result.buildingName && application.buildingName)
        result.buildingName = application.buildingName;
      if (!result.customerName || result.customerName === "") {
        result.customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        result.customerEmail = application.email || "";
        result.customerPhone = application.phoneNumber || "";
      }
    }
  }

  // User info
  if (payment.userId && typeof payment.userId === "object") {
    const user: any = payment.userId;
    result.user = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      username: user.username,
      status: user.status,
      buildingId: user.buildingId,
    };
    if (user.buildingId && !result.buildingId)
      result.buildingId = user.buildingId;
    if (!result.customerName || result.customerName === "") {
      result.customerName =
        `${user.firstName || ""} ${user.lastName || ""}`.trim();
      result.customerEmail = user.email || "";
      result.customerPhone = user.phoneNumber || "";
    }
  }

  return result;
}

// ==================== CREATE PAYMENT ====================
export const createPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      amount,
      paymentMethod,
      billingId,
      paymentType,
      referenceNumber,
      notes,
      customerName,
      customerEmail,
      customerPhone,
      isFree,
    } = req.body;
    const userId = req.user._id;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ message: "Amount is required" });
    }
    if (!billingId) {
      return res.status(400).json({ message: "Billing ID is required" });
    }

    const billing = await Billing.findById(billingId).populate("applicationId");
    if (!billing) {
      return res.status(404).json({ message: "Billing record not found" });
    }

    const correctPaymentType = determinePaymentType(billing, paymentType);

    let customerNameFinal = customerName || "";
    let customerEmailFinal = customerEmail || "";
    let customerPhoneFinal = customerPhone || "";

    if (billing.applicationId) {
      if (
        typeof billing.applicationId === "object" &&
        billing.applicationId !== null
      ) {
        const app = billing.applicationId as any;
        customerNameFinal =
          `${app.firstName || ""} ${app.lastName || ""}`.trim();
        customerEmailFinal = app.email || "";
        customerPhoneFinal = app.phoneNumber || "";
      } else {
        const app = await Application.findOne({
          applicationId: billing.applicationId,
        }).lean();
        if (app) {
          customerNameFinal =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          customerEmailFinal = app.email || "";
          customerPhoneFinal = app.phoneNumber || "";
        }
      }
    }

    if (!customerNameFinal && userId) {
      const user = await User.findById(userId);
      if (user) {
        customerNameFinal =
          `${user.firstName || ""} ${user.lastName || ""}`.trim();
        customerEmailFinal = user.email || "";
        customerPhoneFinal = user.phoneNumber || "";
      }
    }
    if (!customerNameFinal && billing.applicationId)
      customerNameFinal = billing.applicationId.toString();
    if (!customerNameFinal) customerNameFinal = "Unknown Customer";

    const paymentData: any = {
      userId,
      amount: Number(amount),
      paymentMethod: paymentMethod || "manual",
      paymentType: correctPaymentType,
      status: isFree ? "completed" : "pending",
      referenceNumber: referenceNumber || `MANUAL-${Date.now()}`,
      billingId,
      customerName: customerNameFinal,
      customerEmail: customerEmailFinal,
      customerPhone: customerPhoneFinal,
      paidAt: isFree ? new Date() : undefined,
      paymentDetails: {
        gateway: isFree ? "free" : "manual",
        gatewayResponse: {
          customerName: customerNameFinal,
          customerEmail: customerEmailFinal,
          customerPhone: customerPhoneFinal,
          isFree: isFree || false,
        },
        notes:
          notes ||
          (isFree
            ? "Marked as free"
            : "Manual payment - pending admin approval"),
        isFree: isFree || false,
      },
    };

    if (billing.applicationId)
      paymentData.applicationId = billing.applicationId;

    const payment = await Payment.create(paymentData);

    if (isFree) {
      // Fire-and-forget confirm so we don't block the response
      setImmediate(async () => {
        try {
          const confirmReq = {
            params: { id: payment._id },
            body: { notes: notes || "Auto-confirmed free payment" },
            user: req.user,
          } as AuthRequest;
          const confirmRes = {
            status: () => ({ json: (data: any) => data }),
          } as any;
          await confirmPayment(confirmReq, confirmRes, next);
        } catch (e) {
          console.error("Free payment auto-confirm failed:", e);
        }
      });
    }

    res.status(201).json({
      success: true,
      message: isFree
        ? "Free payment recorded successfully"
        : "Payment recorded. Waiting for admin confirmation.",
      data: payment,
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    next(error);
  }
};

// ==================== GET USER PAYMENTS ====================
export const getPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user._id;
    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .populate("billingId")
      .lean();

    // Batch application fetch (single query)
    const appIds = payments
      .map((p) => p.applicationId)
      .filter(Boolean) as string[];
    const appMap = await batchFetchApplications(appIds);

    const enrichedPayments = payments.map((payment: any) => {
      const enriched: any = { ...payment };
      correctPaymentTypeFromBilling(enriched, payment.billingId);

      if (payment.applicationId && appMap.has(payment.applicationId)) {
        const app = appMap.get(payment.applicationId)!;
        enriched.application = app;
        if (!enriched.buildingId && app.buildingId)
          enriched.buildingId = app.buildingId;
        if (!enriched.buildingName && app.buildingName)
          enriched.buildingName = app.buildingName;
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
      }
      return enriched;
    });

    res.status(200).json({
      success: true,
      count: enrichedPayments.length,
      data: enrichedPayments,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET SINGLE PAYMENT ====================
export const getPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid payment ID" });

    const payment: any = await getPopulatedPayment(id);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const isOwner =
      payment.userId &&
      payment.userId._id?.toString() === req.user._id.toString();
    const isAdmin =
      req.user.role === "super_admin" || req.user.role === "admin";
    if (!isOwner && !isAdmin)
      return res.status(403).json({ message: "Not authorized" });

    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

// ==================== VERIFY ====================
export const verifyPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { reference } = req.params;
    if (!reference)
      return res.status(400).json({ message: "Reference number is required" });
    const payment = await paymentService.verifyPayment(reference);
    res.status(200).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

// ==================== WEBHOOKS ====================
export const payMongoWebhook = async (
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  try {
    await paymentService.processPaymentWebhook(req.body, "paymongo");
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("PayMongo webhook error:", error);
    res.status(200).json({ received: true, error: "Processing error" });
  }
};

export const dragonPayWebhook = async (
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  try {
    await paymentService.processPaymentWebhook(req.body, "dragonpay");
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("DragonPay webhook error:", error);
    res.status(200).json({ status: "success", error: "Processing error" });
  }
};

// ==================== STATS ====================
export const getPaymentStats = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    // Single $facet aggregation instead of 6 separate calls
    const [facet] = await Payment.aggregate([
      { $match: { status: "completed" } },
      {
        $facet: {
          daily: [
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
              $group: {
                _id: {
                  date: {
                    $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                  },
                  method: "$paymentMethod",
                  type: "$paymentType",
                },
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
            { $sort: { "_id.date": -1 } },
          ],
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
          byType: [
            {
              $group: {
                _id: "$paymentType",
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
          thisMonth: [
            { $match: { createdAt: { $gte: monthStart } } },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    // Pending separately (different status match)
    const [pending] = await Payment.aggregate([
      { $match: { status: "pending" } },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // ✅ FIX: Cast byType to typed array to avoid `unknown`
    const typeMap = new Map<string, TypeStat>(
      ((facet?.byType || []) as TypeStat[]).map((t) => [t._id, t]),
    );

    res.status(200).json({
      success: true,
      data: {
        daily: facet?.daily || [],
        totals: facet?.totals?.[0] || { total: 0, count: 0 },
        subscriptionRevenue: typeMap.get("subscription") || {
          total: 0,
          count: 0,
        },
        proRatedRevenue: typeMap.get("pro_rated") || { total: 0, count: 0 },
        installationFees: typeMap.get("installation") || {
          total: 0,
          count: 0,
        },
        thisMonth: facet?.thisMonth?.[0] || { total: 0, count: 0 },
        pending: pending || { total: 0, count: 0 },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== REFUND ====================
export const refundPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid payment ID" });

    const payment = await paymentService.refundPayment(id, reason);
    res.status(200).json({ success: true, data: payment });
  } catch (error: any) {
    if (error.message === "Payment not found")
      return res.status(404).json({ message: error.message });
    next(error);
  }
};

// ==================== CONFIRM PAYMENT ====================
export const confirmPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  let paymentIdForAsync: string | null = null;
  let customerEmailForAsync = "";
  let locationForAsync = "";

  try {
    const { id } = req.params;
    const { notes, paymentType, customAmount } = req.body;
    const adminId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id)
      .populate("userId")
      .populate("billingId")
      .session(session);

    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.status === "completed") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Payment already confirmed" });
    }

    // ===== CUSTOM AMOUNT =====
    const originalAmount = payment.amount;
    let finalAmount = payment.amount;

    if (customAmount !== undefined && customAmount !== null) {
      const parsedAmount = Number(customAmount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        await session.abortTransaction();
        return res.status(400).json({
          message: "Invalid custom amount. Must be a non-negative number.",
        });
      }
      finalAmount = parsedAmount;
      payment.amount = finalAmount;
      if (!payment.metadata) payment.metadata = {};
      payment.metadata.originalAmount = originalAmount;
      payment.metadata.customAmount = finalAmount;
      payment.metadata.amountAdjustedBy = adminId;
      payment.metadata.amountAdjustedAt = new Date();
      payment.metadata.amountAdjustmentReason =
        notes || "Amount adjusted during confirmation";
    }

    let readableApplicationId = "";
    let customerEmail = "";
    let customerName = "";
    let customer: any = null;
    let location = "";

    if (payment.applicationId) {
      const application = await Application.findOne({
        applicationId: payment.applicationId,
      }).lean();
      if (application) {
        customer = application;
        readableApplicationId = application.applicationId;
        customerEmail = application.email;
        customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        try {
          location = await getLocationFromEntity(application);
        } catch (e) {
          console.error("Error getting location:", e);
        }
        if (!payment.customerName || payment.customerName === "") {
          payment.customerName = customerName;
          payment.customerEmail = customerEmail;
          payment.customerPhone = application.phoneNumber || "";
        }
      }
    } else if (payment.userId) {
      customer = payment.userId as any;
      customerEmail = customer.email;
      customerName =
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
      try {
        location = await getLocationFromEntity(customer);
      } catch (e) {
        console.error("Error getting location:", e);
      }
      if (!payment.customerName || payment.customerName === "") {
        payment.customerName = customerName;
        payment.customerEmail = customerEmail;
        payment.customerPhone = customer.phoneNumber || "";
      }
    }

    // ===== PAYMENT TYPE CORRECTION =====
    const billing = await Billing.findById(payment.billingId).session(session);
    if (billing) {
      if (paymentType) {
        payment.paymentType = paymentType;
      } else if (billing.isInstallationBill === true) {
        payment.paymentType = "installation";
      } else if (billing.installationFee && billing.installationFee > 0) {
        payment.paymentType = "installation";
      } else if (billing.isProRated === true) {
        payment.paymentType = "pro_rated";
      } else if (
        !["subscription", "installation", "pro_rated", "others"].includes(
          payment.paymentType,
        )
      ) {
        payment.paymentType = "subscription";
      }
    }

    payment.status = "completed";
    payment.paidAt = new Date();
    payment.paymentDetails = {
      gateway: payment.paymentDetails?.gateway || "manual",
      gatewayResponse: {
        ...payment.paymentDetails?.gatewayResponse,
        confirmedBy: adminId,
        confirmedAt: new Date(),
        confirmationNotes: notes,
        applicationId: readableApplicationId,
        customerName: payment.customerName,
        customerEmail: payment.customerEmail,
        customerPhone: payment.customerPhone,
        originalAmount,
        finalAmount,
        amountAdjusted: originalAmount !== finalAmount,
      },
      notes: payment.paymentDetails?.notes,
      isFree: payment.paymentDetails?.isFree || false,
    };
    await payment.save({ session });

    if (billing) {
      billing.status = "paid";
      billing.paymentId = payment._id;
      billing.paidAt = new Date();
      if (billing.isInstallationBill || billing.installationFee > 0)
        billing.installationFeePaid = true;
      await billing.save({ session });

      if (billing.billingCycleId) {
        const billingCycle = await BillingCycle.findById(
          billing.billingCycleId,
        ).session(session);
        if (billingCycle) {
          billingCycle.paymentHistory = billingCycle.paymentHistory || [];
          billingCycle.paymentHistory.push({
            billingId: billing._id,
            amount: payment.amount,
            paidAt: new Date(),
          });
          if (billing.isProRated && !billingCycle.proRatedPaid) {
            billingCycle.proRatedPaid = true;
            billingCycle.proRatedPaidAt = new Date();
            if (billingCycle.status === "pending_activation")
              billingCycle.status = "active";
          }
          if (
            billing.isInstallationBill ||
            (billing.installationFee && billing.installationFee > 0)
          )
            billingCycle.installationFeePaid = true;
          await billingCycle.save({ session });
        }
      }
    }

    if (payment.userId) {
      const user = await User.findById(payment.userId).session(session);
      if (user) {
        if (user.billingInfo) user.billingInfo.currentBill = 0;
        if (user.status === "suspended") {
          user.status = "active";
          if (user.mikrotik?.username && user.planId) {
            try {
              await mikrotikService.applyPlanToUser(user, user.planId);
            } catch (e) {
              console.error("Error reconnecting MikroTik:", e);
            }
          }
        }
        await user.save({ session });
      }
    } else if (payment.applicationId) {
      const app = await Application.findOne({
        applicationId: payment.applicationId,
      }).session(session);
      if (app) {
        app.billingStarted = true;
        app.serviceStatus = "active";
        if (
          payment.paymentType === "installation" ||
          (billing && billing.isInstallationBill)
        )
          app.installationFeePaid = true;
        await app.save({ session });
      }
    }

    await session.commitTransaction();

    // ===== RESPOND IMMEDIATELY, THEN DO HEAVY WORK (PDF + EMAIL) =====
    const populatedPayment = await getPopulatedPayment(payment._id.toString());

    res.status(200).json({
      success: true,
      message:
        originalAmount !== finalAmount
          ? `Payment confirmed successfully. Amount adjusted from ₱${originalAmount} to ₱${finalAmount}.`
          : "Payment confirmed successfully.",
      data: populatedPayment,
      amountAdjusted: originalAmount !== finalAmount,
      originalAmount,
      finalAmount,
    });

    // Async: invoice generation + PDF + email (does not block response)
    paymentIdForAsync = payment._id.toString();
    customerEmailForAsync = customerEmail;
    locationForAsync = location;

    setImmediate(() => {
      void (async () => {
        try {
          await postConfirmInvoiceAndEmail(
            paymentIdForAsync!,
            customerEmailForAsync,
            locationForAsync,
          );
        } catch (e) {
          console.error("Post-confirm async task failed:", e);
        }
      })();
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Heavy post-confirmation work: invoice creation, PDF generation, email.
 * Runs asynchronously after the HTTP response is sent.
 */
async function postConfirmInvoiceAndEmail(
  paymentId: string,
  customerEmail: string,
  location: string,
) {
  if (!customerEmail) return;

  const payment: any = await Payment.findById(paymentId).lean();
  if (!payment) return;

  const billing: any = payment.billingId
    ? await Billing.findById(payment.billingId).lean()
    : null;

  let invoice: any = await Invoice.findOne({
    billingId: billing?._id,
    applicationId: payment.applicationId,
  }).lean();

  if (!invoice && billing) {
    const app: any = await Application.findOne({
      applicationId: payment.applicationId,
    }).lean();

    let plan: any = null;
    if (app?.planId) plan = await Plan.findById(app.planId).lean();

    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    const invoiceNumberGen = `INV-${year}${month}${day}-${timestamp}${random}`;

    const invoiceItems: any[] = [];
    let subtotal = 0;

    if (billing.items && billing.items.length > 0) {
      for (const item of billing.items) {
        invoiceItems.push({
          description: item.description,
          quantity: item.quantity || 1,
          rate: item.rate,
          amount: item.amount,
          type: (item as any).type || "subscription",
        });
        subtotal += item.amount;
      }
    } else {
      const monthlyRate = plan?.price || 0;

      if (billing.isProRated) {
        const proRatedDays = billing.proRatedDays || 0;
        const dailyRate = (monthlyRate * 12) / 365;
        const proRatedAmount = Math.round(dailyRate * proRatedDays * 100) / 100;
        invoiceItems.push({
          description: `Pro-rated (${billing.billingPeriod?.start ? new Date(billing.billingPeriod.start).toLocaleDateString() : "N/A"} - ${billing.billingPeriod?.end ? new Date(billing.billingPeriod.end).toLocaleDateString() : "N/A"})`,
          quantity: proRatedDays,
          rate: dailyRate,
          amount: proRatedAmount,
          type: "pro-rated",
        });
        subtotal += proRatedAmount;
      }

      const installationFeeAmount = billing.installationFee || 0;
      if (installationFeeAmount > 0) {
        invoiceItems.push({
          description: "Installation Fee (One-time)",
          quantity: 1,
          rate: installationFeeAmount,
          amount: installationFeeAmount,
          type: "installation",
        });
        subtotal += installationFeeAmount;
      }

      if (!billing.isProRated) {
        invoiceItems.push({
          description: `Monthly Subscription - ${billing.billingPeriod?.start ? new Date(billing.billingPeriod.start).toLocaleDateString() : "N/A"} to ${billing.billingPeriod?.end ? new Date(billing.billingPeriod.end).toLocaleDateString() : "N/A"}`,
          quantity: 1,
          rate: monthlyRate,
          amount: monthlyRate,
          type: "subscription",
        });
        subtotal += monthlyRate;
      }
    }

    let invoiceTypeFinal = "monthly";
    const isInstallationFee =
      billing.isInstallationBill || billing.installationFee > 0;
    const isProRated = billing.isProRated || false;

    if (isInstallationFee && isProRated) invoiceTypeFinal = "combined";
    else if (isInstallationFee) invoiceTypeFinal = "installation";
    else if (isProRated) invoiceTypeFinal = "pro-rated";

    const total = subtotal;
    const customerAddress = app?.buildingName || app?.address || "N/A";
    const planName = plan?.name || "N/A";

    const isWilconnect = WILCONNECT_BUILDINGS.some((b) =>
      ((app?.buildingName as string) || "").toLowerCase().includes(b),
    );

    const finalCollectionEmail = isWilconnect
      ? WORKSELPUEBLO_EMAIL
      : getCollectionEmailByLocation(location) || "admin@misterfyber.com";

    const brandName = isWilconnect
      ? "WILCONNECT NETWORK CORPORATION"
      : "Fyberblizz Network Corporation";

    const invoiceData = {
      invoiceNumber: invoiceNumberGen,
      invoiceType: invoiceTypeFinal,
      applicationId: payment.applicationId,
      userId: payment.userId,
      customerName: payment.customerName,
      customerAddress,
      customerEmail,
      customerPhone: payment.customerPhone || "",
      companyName: brandName,
      companyAddress:
        "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
      companyVat: "697-461-165-00000",
      companyContact: "0969-341-4876",
      companyEmail: finalCollectionEmail,
      billingPeriod: {
        start: billing.billingPeriod?.start || new Date(),
        end: billing.billingPeriod?.end || new Date(),
      },
      dueDate: billing.dueDate || new Date(),
      issuedDate: new Date(),
      items: invoiceItems,
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      discountAmount: 0,
      total,
      bankName: "BDO",
      accountName: isWilconnect
        ? "WILCONNECT NETWORK CORPORATION"
        : "FYBERBLIZZ NETWORK CORPORATION",
      accountNumber: "013448002421",
      status: "paid",
      billingId: billing._id,
      billingCycleId: billing.billingCycleId,
      isInstallationFee,
      isProRated,
      proRatedDays: billing.proRatedDays || 0,
      planName,
      notes: billing.notes || "",
      termsAndConditions:
        "Please be advised that failure to settle your account on or before the due date may result in temporary service interruption.",
      location: location || "",
      collectionEmail: finalCollectionEmail,
      paidAt: new Date(),
      paymentId: payment._id,
    };

    invoice = await Invoice.create(invoiceData);
    invoice = invoice.toObject();
  }

  if (!invoice) return;

  // Generate PDF if needed
  let pdfBuffer: Buffer;
  const pdfFileName = `${invoice.invoiceNumber}.pdf`;

  if (invoice.pdfUrl) {
    const filePath = path.join(__dirname, "../..", invoice.pdfUrl);
    if (fs.existsSync(filePath)) {
      pdfBuffer = fs.readFileSync(filePath);
    } else {
      pdfBuffer = await generateInvoicePDF(invoice);
      const pdfDir = path.join(__dirname, "../../uploads/invoices");
      if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
      fs.writeFileSync(path.join(pdfDir, pdfFileName), pdfBuffer);
      await Invoice.findByIdAndUpdate(invoice._id, {
        pdfUrl: `/uploads/invoices/${pdfFileName}`,
        pdfGeneratedAt: new Date(),
      });
    }
  } else {
    pdfBuffer = await generateInvoicePDF(invoice);
    const pdfDir = path.join(__dirname, "../../uploads/invoices");
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    fs.writeFileSync(path.join(pdfDir, pdfFileName), pdfBuffer);
    await Invoice.findByIdAndUpdate(invoice._id, {
      pdfUrl: `/uploads/invoices/${pdfFileName}`,
      pdfGeneratedAt: new Date(),
    });
  }

  await emailService.sendPaidInvoiceEmail(
    invoice,
    pdfBuffer,
    pdfFileName,
    payment,
    location,
    false,
  );
}

// ==================== UPDATE PAYMENT ====================
export const updatePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const {
      amount,
      paymentMethod,
      paymentType,
      status,
      referenceNumber,
      notes,
      customerName,
      customerEmail,
      customerPhone,
      paidAt,
      transactionId,
    } = req.body;
    const adminId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id).session(session);
    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Payment not found" });
    }

    const originalSnapshot = {
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      paymentType: payment.paymentType,
      status: payment.status,
      referenceNumber: payment.referenceNumber,
      customerName: payment.customerName,
      customerEmail: payment.customerEmail,
      customerPhone: payment.customerPhone,
      paidAt: payment.paidAt,
      transactionId: payment.transactionId,
    };

    if (amount !== undefined && amount !== null) {
      const parsed = Number(amount);
      if (isNaN(parsed) || parsed < 0) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ message: "Invalid amount. Must be a non-negative number." });
      }
      payment.amount = parsed;
    }

    if (paymentMethod !== undefined && paymentMethod !== null) {
      const validMethods = [
        "paymongo",
        "dragonpay",
        "gcash",
        "maya",
        "card",
        "bank_transfer",
        "manual",
        "free",
      ];
      if (!validMethods.includes(paymentMethod)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid payment method" });
      }
      payment.paymentMethod = paymentMethod;
    }

    if (paymentType !== undefined && paymentType !== null) {
      const validTypes = [
        "subscription",
        "installation",
        "pro_rated",
        "others",
      ];
      if (!validTypes.includes(paymentType)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid payment type" });
      }
      payment.paymentType = paymentType;
    }

    if (status !== undefined && status !== null) {
      const validStatuses = [
        "pending",
        "processing",
        "completed",
        "failed",
        "refunded",
      ];
      if (!validStatuses.includes(status)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid status" });
      }
      payment.status = status;
      if (status === "completed" && !payment.paidAt)
        payment.paidAt = new Date();
    }

    if (referenceNumber !== undefined && referenceNumber !== null) {
      const trimmed = String(referenceNumber).trim();
      if (trimmed.length > 0) {
        const existing = await Payment.findOne({
          referenceNumber: trimmed,
          _id: { $ne: payment._id },
        }).session(session);
        if (existing) {
          await session.abortTransaction();
          return res
            .status(400)
            .json({ message: "Reference number already exists" });
        }
        payment.referenceNumber = trimmed;
      }
    }

    if (customerName !== undefined && customerName !== null)
      payment.customerName = String(customerName).trim();
    if (customerEmail !== undefined && customerEmail !== null)
      payment.customerEmail = String(customerEmail).trim();
    if (customerPhone !== undefined && customerPhone !== null)
      payment.customerPhone = String(customerPhone).trim();

    if (paidAt !== undefined && paidAt !== null) {
      const d = new Date(paidAt);
      if (isNaN(d.getTime())) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid paidAt date" });
      }
      payment.paidAt = d;
    }

    if (transactionId !== undefined && transactionId !== null)
      payment.transactionId = String(transactionId).trim();

    if (notes !== undefined && notes !== null) {
      if (!payment.paymentDetails) {
        payment.paymentDetails = {
          gateway: "manual",
          gatewayResponse: {},
        } as any;
      }
      payment.paymentDetails.notes = String(notes);
    }

    if (!payment.metadata) payment.metadata = {};
    payment.metadata.lastEditedBy = adminId;
    payment.metadata.lastEditedAt = new Date();
    payment.metadata.originalSnapshot = originalSnapshot;

    await payment.save({ session });

    if (
      payment.billingId &&
      status !== undefined &&
      originalSnapshot.status !== status
    ) {
      const billing = await Billing.findById(payment.billingId).session(
        session,
      );
      if (billing) {
        if (status === "completed") {
          billing.status = "paid";
          billing.paymentId = payment._id;
          billing.paidAt = payment.paidAt || new Date();
          if (billing.isInstallationBill || billing.installationFee > 0)
            billing.installationFeePaid = true;
        } else if (originalSnapshot.status === "completed") {
          billing.status = "pending_confirmation";
          billing.paymentId = undefined;
          billing.paidAt = undefined;
          if (billing.isInstallationBill || billing.installationFee > 0)
            billing.installationFeePaid = false;
        }
        await billing.save({ session });
      }
    }

    await session.commitTransaction();

    const updatedPayment = await getPopulatedPayment(payment._id.toString());
    res.status(200).json({
      success: true,
      message: "Payment updated successfully",
      data: updatedPayment,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== GET PENDING PAYMENTS ====================
export const getPendingPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500); // cap
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find({ status: "pending" })
        .populate(
          "userId",
          "firstName lastName email username phoneNumber status buildingId",
        )
        .populate(
          "billingId",
          "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod buildingId",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments({ status: "pending" }),
    ]);

    // Batch apps
    const appIds = payments
      .map((p) => p.applicationId)
      .filter(Boolean) as string[];
    const appMap = await batchFetchApplications(appIds);

    const enrichedPayments = payments.map((payment: any) => {
      const enriched: any = { ...payment };
      correctPaymentTypeFromBilling(enriched, payment.billingId);

      if (payment.applicationId && appMap.has(payment.applicationId)) {
        const app = appMap.get(payment.applicationId)!;
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.status,
          serviceStatus: app.serviceStatus || "pending",
          billingStarted: app.billingStarted,
          installationFee: app.installationFee || 0,
          installationFeePaid: app.installationFeePaid || false,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
          buildingId: app.buildingId,
          buildingName: app.buildingName || "",
        };
        enriched.applicationId = app.applicationId;
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
        if (app.buildingId && !enriched.buildingId)
          enriched.buildingId = app.buildingId;
        if (app.buildingName && !enriched.buildingName)
          enriched.buildingName = app.buildingName;
      }

      if (
        !enriched.application &&
        payment.paymentDetails?.gatewayResponse?.applicationId
      ) {
        enriched.readableApplicationId =
          payment.paymentDetails.gatewayResponse.applicationId;
      }

      if (payment.userId && typeof payment.userId === "object") {
        const user = payment.userId as any;
        enriched.user = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          username: user.username,
          status: user.status,
          buildingId: user.buildingId,
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
          enriched.customerEmail = user.email || "";
          enriched.customerPhone = user.phoneNumber || "";
        }
        if (user.buildingId && !enriched.buildingId)
          enriched.buildingId = user.buildingId;
      }

      enriched.isInstallationPayment =
        payment.paymentType === "installation" ||
        (payment.billingId &&
          typeof payment.billingId === "object" &&
          (payment.billingId as any).isInstallationBill);

      return enriched;
    });

    res.status(200).json({
      success: true,
      data: enrichedPayments,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
};

// ==================== GET ALL PAYMENTS ADMIN ====================
export const getAllPaymentsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limitParam = req.query.limit as string;
    const fetchAll = limitParam === "all" || limitParam === "0";
    const limit = fetchAll ? 0 : Math.min(parseInt(limitParam) || 100, 1000);
    const skip = fetchAll ? 0 : (page - 1) * limit;
    const status = req.query.status as string;
    const paymentType = req.query.paymentType as string;
    const search = req.query.search as string;
    const buildingId = req.query.buildingId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const includeStats = req.query.stats !== "false";

    // Build base query
    const baseQuery: any = {};

    if (status && status !== "all" && status !== "") baseQuery.status = status;
    if (paymentType && paymentType !== "all" && paymentType !== "")
      baseQuery.paymentType = paymentType;

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      baseQuery.createdAt = { $gte: start, $lte: end };
    } else if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      baseQuery.createdAt = { $gte: start };
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      baseQuery.createdAt = { $lte: end };
    }

    if (search) {
      baseQuery.$or = [
        { referenceNumber: { $regex: search, $options: "i" } },
        { applicationId: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerEmail: { $regex: search, $options: "i" } },
      ];
    }

    // ===== BUILDING FILTER (parallel, projected) =====
    let buildingFilterClause: any = null;

    if (buildingId && buildingId !== "all" && buildingId !== "") {
      const [buildingApps, buildingUsers] = await Promise.all([
        Application.find({ buildingId }).select("applicationId").lean(),
        User.find({ buildingId }).select("_id").lean(),
      ]);
      const buildingApplicationIds = buildingApps
        .map((a) => a.applicationId)
        .filter(Boolean);
      const buildingUserIds = buildingUsers.map((u) => u._id);

      // Only build Billing subquery if we have appIds; otherwise rely on billingId field
      let buildingBillingIds: any[] = [];
      if (buildingApplicationIds.length > 0) {
        const billings = await Billing.find({
          $or: [
            { applicationId: { $in: buildingApplicationIds } },
            { buildingId },
          ],
        })
          .select("_id")
          .lean();
        buildingBillingIds = billings.map((b) => b._id);
      } else {
        const billings = await Billing.find({ buildingId })
          .select("_id")
          .lean();
        buildingBillingIds = billings.map((b) => b._id);
      }

      const orConditions: any[] = [{ buildingId }];
      if (buildingApplicationIds.length > 0) {
        orConditions.push({ applicationId: { $in: buildingApplicationIds } });
      }
      if (buildingUserIds.length > 0)
        orConditions.push({ userId: { $in: buildingUserIds } });
      if (buildingBillingIds.length > 0)
        orConditions.push({ billingId: { $in: buildingBillingIds } });
      if (buildingApplicationIds.length > 0) {
        orConditions.push({
          "paymentDetails.gatewayResponse.applicationId": {
            $in: buildingApplicationIds,
          },
        });
      }

      buildingFilterClause = { $or: orConditions };
    }

    const query: any = buildingFilterClause
      ? { $and: [baseQuery, buildingFilterClause] }
      : { ...baseQuery };

    // Fetch payments + count in parallel
    const findQuery = Payment.find(query)
      .populate(
        "userId",
        "firstName lastName email username phoneNumber status buildingId",
      )
      .populate(
        "billingId",
        "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod buildingId",
      )
      .sort({ createdAt: -1 });

    if (!fetchAll) findQuery.skip(skip).limit(limit);

    const countPromise = fetchAll
      ? Promise.resolve(0)
      : Payment.countDocuments(query);

    const [payments, total] = await Promise.all([
      findQuery.lean(),
      countPromise,
    ]);

    // ===== BATCH ENRICHMENT =====
    const appIdsSet = new Set<string>();
    for (const payment of payments) {
      if (payment.applicationId && typeof payment.applicationId === "string")
        appIdsSet.add(payment.applicationId);
    }
    const appMap = await batchFetchApplications(Array.from(appIdsSet));

    const enrichedPayments = payments.map((payment: any) => {
      const enriched: any = { ...payment };
      correctPaymentTypeFromBilling(enriched, payment.billingId);

      if (payment.applicationId && appMap.has(payment.applicationId)) {
        const app = appMap.get(payment.applicationId)!;
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName || "",
          lastName: app.lastName || "",
          email: app.email || "",
          phoneNumber: app.phoneNumber || "",
          status: app.status || "",
          serviceStatus: app.serviceStatus || "pending",
          billingStarted: app.billingStarted || false,
          installationFee: app.installationFee || 0,
          installationFeePaid: app.installationFeePaid || false,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
          fullName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
          buildingId: app.buildingId,
          buildingName: app.buildingName || "",
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
        if (app.buildingId) enriched.buildingId = app.buildingId;
        if (app.buildingName) enriched.buildingName = app.buildingName;
      }

      if (
        !enriched.application &&
        payment.userId &&
        typeof payment.userId === "object"
      ) {
        const user = payment.userId as any;
        enriched.user = {
          _id: user._id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          username: user.username || "",
          status: user.status || "",
          buildingId: user.buildingId || "",
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
          enriched.customerEmail = user.email || "";
          enriched.customerPhone = user.phoneNumber || "";
        }
        if (user.buildingId && !enriched.buildingId)
          enriched.buildingId = user.buildingId;
      }

      if (!enriched.customerName || enriched.customerName === "")
        enriched.customerName =
          payment.applicationId || payment.customerName || "Unknown Customer";
      if (!enriched.customerEmail || enriched.customerEmail === "")
        enriched.customerEmail = payment.customerEmail || "";
      if (!enriched.customerPhone || enriched.customerPhone === "")
        enriched.customerPhone = payment.customerPhone || "";

      enriched.isInstallationPayment =
        payment.paymentType === "installation" ||
        (payment.billingId &&
          typeof payment.billingId === "object" &&
          (payment.billingId as any).isInstallationBill);

      return enriched;
    });

    // ===== STATS (optional, single $facet) =====
    let stats: any = undefined;
    if (includeStats) {
      // Build a stats base: same filters EXCEPT status (so we can show all breakdowns)
      const statsBase = buildingFilterClause
        ? {
            $and: [
              (() => {
                const q = { ...baseQuery };
                delete q.status;
                delete q.paymentType;
                return q;
              })(),
              buildingFilterClause,
            ],
          }
        : (() => {
            const q = { ...baseQuery };
            delete q.status;
            delete q.paymentType;
            return q;
          })();

      const monthStart = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      );

      const [facet] = await Payment.aggregate([
        { $match: statsBase },
        {
          $facet: {
            completed: [
              { $match: { status: "completed" } },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$amount" },
                  count: { $sum: 1 },
                },
              },
            ],
            monthly: [
              {
                $match: {
                  status: "completed",
                  createdAt: { $gte: monthStart },
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$amount" },
                  count: { $sum: 1 },
                },
              },
            ],
            byType: [
              { $match: { status: "completed" } },
              {
                $group: {
                  _id: "$paymentType",
                  total: { $sum: "$amount" },
                  count: { $sum: 1 },
                },
              },
            ],
            pending: [
              { $match: { status: "pending" } },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$amount" },
                  count: { $sum: 1 },
                },
              },
            ],
          },
        },
      ]);

      // ✅ FIX: Cast byType to typed array so `.total`/`.count` are known
      const typeMap = new Map<string, TypeStat>(
        ((facet?.byType || []) as TypeStat[]).map((t) => [t._id, t]),
      );

      stats = {
        total: facet?.completed?.[0]?.total || 0,
        totalCount: facet?.completed?.[0]?.count || 0,
        monthly: facet?.monthly?.[0]?.total || 0,
        monthlyCount: facet?.monthly?.[0]?.count || 0,
        subscription: typeMap.get("subscription")?.total || 0,
        subscriptionCount: typeMap.get("subscription")?.count || 0,
        proRated: typeMap.get("pro_rated")?.total || 0,
        proRatedCount: typeMap.get("pro_rated")?.count || 0,
        installationFees: typeMap.get("installation")?.total || 0,
        installationFeeCount: typeMap.get("installation")?.count || 0,
        pending: facet?.pending?.[0]?.total || 0,
        pendingCount: facet?.pending?.[0]?.count || 0,
      };
    }

    res.status(200).json({
      success: true,
      data: enrichedPayments,
      total: fetchAll ? enrichedPayments.length : total,
      page: fetchAll ? 1 : page,
      totalPages: fetchAll ? 1 : Math.ceil(total / limit) || 1,
      ...(stats ? { stats } : {}),
    });
  } catch (error) {
    console.error("Error in getAllPaymentsAdmin:", error);
    next(error);
  }
};

// ==================== REJECT PAYMENT ====================
export const rejectPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid payment ID" });

    const payment: any = await Payment.findById(id)
      .populate("userId", "firstName lastName email")
      .populate(
        "billingId",
        "invoiceNumber total isInstallationBill installationFee isProRated",
      )
      .lean();

    if (!payment) return res.status(404).json({ message: "Payment not found" });
    if (payment.status === "completed")
      return res.status(400).json({ message: "Payment already confirmed" });
    if (payment.status === "failed")
      return res.status(400).json({ message: "Payment already rejected" });

    let customerEmail = "";
    let customerName = payment.customerName || "";
    let location = "";

    if (payment.applicationId) {
      const application = await Application.findOne({
        applicationId: payment.applicationId,
      }).lean();
      if (application) {
        customerEmail = application.email;
        if (!customerName || customerName === "")
          customerName =
            `${application.firstName || ""} ${application.lastName || ""}`.trim();
        try {
          location = await getLocationFromEntity(application);
        } catch (e) {
          console.error("Error getting location:", e);
        }
      }
    } else if (payment.userId) {
      const user = await User.findById(payment.userId).lean();
      if (user) {
        customerEmail = user.email;
        if (!customerName || customerName === "")
          customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
        try {
          location = await getLocationFromEntity(user);
        } catch (e) {
          console.error("Error getting location:", e);
        }
      }
    }

    await Payment.updateOne(
      { _id: id },
      {
        $set: {
          status: "failed",
          "paymentDetails.gatewayResponse.rejectionReason":
            reason || "Payment verification failed",
          "paymentDetails.gatewayResponse.rejectedAt": new Date(),
          "paymentDetails.gatewayResponse.rejectedBy": req.user._id,
        },
      },
    );

    const updatedPayment = await Payment.findById(id).lean();

    // Fire-and-forget email so response is fast
    if (customerEmail) {
      setImmediate(async () => {
        try {
          const isInstallationPayment =
            payment.paymentType === "installation" ||
            (payment.billingId &&
              typeof payment.billingId === "object" &&
              (payment.billingId as any).isInstallationBill);

          const subject = isInstallationPayment
            ? "Installation Fee Payment Failed - Mister Fyber"
            : "Payment Verification Failed - Mister Fyber";

          const message = `
            Dear ${customerName || "Customer"},
            
            Your payment of ₱${payment.amount.toLocaleString()} could not be verified.
            
            Reason: ${reason || "Please contact support for more information"}
            
            ${isInstallationPayment ? "Please submit your installation fee payment again to proceed with your installation." : "Please submit your payment again or contact our support team."}
            
            Mister Fyber - Your trusted internet provider
          `;

          await emailService.sendEmail(
            customerEmail,
            subject,
            message,
            true,
            location,
          );
        } catch (emailError) {
          console.error("Error sending rejection email:", emailError);
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment rejected",
      data: {
        _id: updatedPayment?._id,
        userId: updatedPayment?.userId,
        applicationId: updatedPayment?.applicationId,
        amount: updatedPayment?.amount,
        status: updatedPayment?.status,
        referenceNumber: updatedPayment?.referenceNumber,
        paymentType: updatedPayment?.paymentType,
        customerName: updatedPayment?.customerName || payment.customerName,
        customerEmail: updatedPayment?.customerEmail || payment.customerEmail,
        customerPhone: updatedPayment?.customerPhone || payment.customerPhone,
        paymentDetails: updatedPayment?.paymentDetails,
        createdAt: updatedPayment?.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== INSTALLATION SUMMARY ====================
export const getInstallationPaymentSummary = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    const [facet] = await Payment.aggregate([
      { $match: { paymentType: "installation" } },
      {
        $facet: {
          completed: [
            { $match: { status: "completed" } },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
          pending: [
            { $match: { status: "pending" } },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
          thisMonth: [
            {
              $match: {
                status: "completed",
                createdAt: { $gte: monthStart },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
          recent: [
            { $match: { status: "completed" } },
            { $sort: { createdAt: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: facet?.completed?.[0]?.total || 0,
        totalCount: facet?.completed?.[0]?.count || 0,
        pendingCount: facet?.pending?.[0]?.count || 0,
        pendingTotal: facet?.pending?.[0]?.total || 0,
        thisMonth: facet?.thisMonth?.[0] || { total: 0, count: 0 },
        recentPayments: facet?.recent || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== DELETE PAYMENT ====================
export const deletePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid payment ID" });

    const payment = await Payment.findById(id);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const paymentData = {
      _id: payment._id,
      amount: payment.amount,
      referenceNumber: payment.referenceNumber,
      status: payment.status,
      paymentType: payment.paymentType,
      customerName: payment.customerName,
      customerEmail: payment.customerEmail,
      createdAt: payment.createdAt,
    };

    const billingUpdate =
      payment.status === "completed" && payment.billingId
        ? (async () => {
            try {
              const billing = await Billing.findById(payment.billingId);
              if (!billing) return;
              billing.paymentId = undefined;
              billing.status = "pending_confirmation";
              billing.paidAt = undefined;
              if (billing.isInstallationBill || billing.installationFee > 0)
                billing.installationFeePaid = false;
              await billing.save();
            } catch (e) {
              console.error("Error updating billing after deletion:", e);
            }
          })()
        : Promise.resolve();

    await Promise.all([Payment.findByIdAndDelete(id), billingUpdate]);

    res.status(200).json({
      success: true,
      message: `Payment ${paymentData.referenceNumber} deleted successfully`,
      data: paymentData,
    });
  } catch (error) {
    console.error("Error deleting payment:", error);
    next(error);
  }
};

// ==================== BULK DELETE CUSTOMER PAYMENTS ====================
export const bulkDeleteCustomerPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { customerId } = req.params;
    const { deleteAll } = req.body;

    if (!customerId)
      return res.status(400).json({ message: "Customer ID is required" });

    const query: any = {
      $or: [
        { applicationId: customerId },
        { customerEmail: customerId },
        { "paymentDetails.gatewayResponse.applicationId": customerId },
      ],
    };
    if (!deleteAll) query.status = "pending";

    // Fetch minimal fields to collect billingIds for later update
    const payments = await Payment.find(query)
      .select("_id billingId referenceNumber")
      .lean();

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No payments found for customer: ${customerId}`,
      });
    }

    const paymentIds = payments.map((p) => p._id);
    const paymentRefs = payments.map((p) => p.referenceNumber);
    const billingIds = payments.map((p) => p.billingId).filter(Boolean);

    const result = await Payment.deleteMany({ _id: { $in: paymentIds } });

    // Bulk update billings in one go
    if (billingIds.length > 0) {
      try {
        await Billing.updateMany(
          { _id: { $in: billingIds } },
          {
            $set: {
              paymentId: undefined,
              status: "pending_confirmation",
              paidAt: undefined,
            },
          },
        );
      } catch (e) {
        console.error("Error bulk-updating billings:", e);
      }
    }

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} payments for customer ${customerId}`,
      data: {
        deletedCount: result.deletedCount,
        paymentIds,
        paymentRefs,
      },
    });
  } catch (error) {
    console.error("Error bulk deleting customer payments:", error);
    next(error);
  }
};

// ==================== MIGRATION ====================
export const fixProRatedPaymentTypes = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can run this migration",
      });
    }

    console.log("🔧 Starting pro-rated payment type migration...");

    // Stream / batch process to avoid loading everything into memory
    const cursor = Payment.find({
      billingId: { $exists: true, $ne: null },
    })
      .populate("billingId", "isProRated isInstallationBill installationFee")
      .lean()
      .cursor();

    let fixedToProRated = 0;
    let fixedToInstallation = 0;
    let fixedToSubscription = 0;
    let totalProcessed = 0;
    const details: any[] = [];
    const bulkOps: any[] = [];

    for await (const payment of cursor as any) {
      totalProcessed++;
      const billing = payment.billingId;
      if (!billing) continue;

      let correctType = payment.paymentType;
      if (billing.isInstallationBill === true) {
        correctType = "installation";
      } else if (billing.installationFee && billing.installationFee > 0) {
        correctType = "installation";
      } else if (billing.isProRated === true) {
        correctType = "pro_rated";
      } else if (
        !["subscription", "installation", "pro_rated", "others"].includes(
          payment.paymentType,
        )
      ) {
        correctType = "subscription";
      }

      if (correctType !== payment.paymentType) {
        bulkOps.push({
          updateOne: {
            filter: { _id: payment._id },
            update: { $set: { paymentType: correctType } },
          },
        });
        if (correctType === "pro_rated") fixedToProRated++;
        else if (correctType === "installation") fixedToInstallation++;
        else if (correctType === "subscription") fixedToSubscription++;

        details.push({
          paymentId: payment._id,
          referenceNumber: payment.referenceNumber,
          oldType: payment.paymentType,
          newType: correctType,
        });
      }
    }

    if (bulkOps.length > 0) await Payment.bulkWrite(bulkOps);

    res.status(200).json({
      success: true,
      message: `Fixed ${fixedToProRated + fixedToInstallation + fixedToSubscription} payments`,
      data: {
        totalProcessed,
        fixedToProRated,
        fixedToInstallation,
        fixedToSubscription,
        details,
      },
    });
  } catch (error) {
    console.error("Error in fixProRatedPaymentTypes:", error);
    next(error);
  }
};

export default {
  createPayment,
  getPayments,
  getPayment,
  verifyPayment,
  payMongoWebhook,
  dragonPayWebhook,
  getPaymentStats,
  refundPayment,
  confirmPayment,
  updatePayment,
  rejectPayment,
  getPendingPayments,
  getAllPaymentsAdmin,
  getInstallationPaymentSummary,
  deletePayment,
  bulkDeleteCustomerPayments,
  fixProRatedPaymentTypes,
};
