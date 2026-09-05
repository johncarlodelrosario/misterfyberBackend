// backend/src/controllers/paymentController.ts - COMPLETE WITH BULK DELETE AND FREE SUPPORT

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

// Helper function to get populated customer data
async function getPopulatedPayment(paymentId: string) {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) {
    return null;
  }

  const payment = await Payment.findById(paymentId)
    .populate(
      "userId",
      "firstName lastName email username phoneNumber status mikrotik planId",
    )
    .populate(
      "billingId",
      "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod",
    )
    .lean();

  if (!payment) return null;

  const result: any = { ...payment };

  if (payment.applicationId) {
    const application = await Application.findOne({
      applicationId: payment.applicationId,
    })
      .select(
        "firstName lastName email applicationId phoneNumber status serviceStatus billingStarted installationFee installationFeePaid",
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
        serviceStatus: (application as any).serviceStatus || "pending",
        billingStarted: application.billingStarted,
        installationFee: (application as any).installationFee || 0,
        installationFeePaid: (application as any).installationFeePaid || false,
        applicantName:
          `${application.firstName || ""} ${application.lastName || ""}`.trim(),
      };
      result.applicationId = application.applicationId;

      if (!result.customerName || result.customerName === "") {
        result.customerName =
          `${application.firstName || ""} ${application.lastName || ""}`.trim();
        result.customerEmail = application.email || "";
        result.customerPhone = application.phoneNumber || "";
      }
    }
  }

  if (payment.userId && typeof payment.userId === "object") {
    const user = payment.userId as any;
    result.user = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      username: user.username,
      status: user.status,
    };

    if (!result.customerName || result.customerName === "") {
      result.customerName =
        `${user.firstName || ""} ${user.lastName || ""}`.trim();
      result.customerEmail = user.email || "";
      result.customerPhone = user.phoneNumber || "";
    }
  }

  return result;
}

// @desc    Create payment (manual - pending status only)
// @route   POST /api/payments
// @access  Private
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

    // Allow zero amount for free payments
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

    if (!customerNameFinal && billing.applicationId) {
      customerNameFinal = billing.applicationId.toString();
    }

    if (!customerNameFinal) {
      customerNameFinal = "Unknown Customer";
    }

    const paymentData: any = {
      userId,
      amount: Number(amount),
      paymentMethod: paymentMethod || "manual",
      paymentType:
        paymentType ||
        (billing.isInstallationBill ? "installation" : "subscription"),
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

    if (billing.applicationId) {
      paymentData.applicationId = billing.applicationId;
    }

    const payment = await Payment.create(paymentData);

    // If free payment, auto-confirm it
    if (isFree) {
      // Create a fake request for auto-confirmation
      const confirmReq = {
        params: { id: payment._id },
        body: { notes: notes || "Auto-confirmed free payment" },
        user: req.user,
      } as AuthRequest;

      const confirmRes = {
        status: (code: number) => ({
          json: (data: any) => data,
        }),
      } as any;

      await confirmPayment(confirmReq, confirmRes, next);
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

// @desc    Get all payments for user
// @route   GET /api/payments
// @access  Private
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

    const enrichedPayments = await Promise.all(
      payments.map(async (payment) => {
        const enriched: any = { ...payment };
        if (payment.applicationId) {
          const application = await Application.findOne({
            applicationId: payment.applicationId,
          })
            .select("firstName lastName email applicationId phoneNumber")
            .lean();
          if (application) {
            enriched.application = application;
            if (!enriched.customerName || enriched.customerName === "") {
              enriched.customerName =
                `${application.firstName || ""} ${application.lastName || ""}`.trim();
              enriched.customerEmail = application.email || "";
              enriched.customerPhone = application.phoneNumber || "";
            }
          }
        }
        return enriched;
      }),
    );

    res.status(200).json({
      success: true,
      count: enrichedPayments.length,
      data: enrichedPayments,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single payment
// @route   GET /api/payments/:id
// @access  Private
export const getPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await getPopulatedPayment(id);

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    const isOwner =
      payment.userId &&
      payment.userId._id?.toString() === req.user._id.toString();
    const isAdmin =
      req.user.role === "super_admin" || req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify payment
// @route   GET /api/payments/verify/:reference
// @access  Private
export const verifyPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ message: "Reference number is required" });
    }

    const payment = await paymentService.verifyPayment(reference);
    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    PayMongo webhook
// @route   POST /api/payments/webhook/paymongo
// @access  Public
export const payMongoWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await paymentService.processPaymentWebhook(req.body, "paymongo");
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("PayMongo webhook error:", error);
    res.status(200).json({ received: true, error: "Processing error" });
  }
};

// @desc    DragonPay webhook
// @route   POST /api/payments/webhook/dragonpay
// @access  Public
export const dragonPayWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await paymentService.processPaymentWebhook(req.body, "dragonpay");
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("DragonPay webhook error:", error);
    res.status(200).json({ status: "success", error: "Processing error" });
  }
};

// @desc    Get payment statistics
// @route   GET /api/payments/stats
// @access  Private/Admin
export const getPaymentStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const stats = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            method: "$paymentMethod",
            type: "$paymentType",
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.date": -1 },
      },
    ]);

    const totalRevenue = await Payment.aggregate([
      {
        $match: { status: "completed" },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const subscriptionRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          paymentType: "subscription",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const installationFeeRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          paymentType: "installation",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const thisMonthRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const pendingPayments = await Payment.aggregate([
      {
        $match: { status: "pending" },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        daily: stats,
        totals: totalRevenue[0] || { total: 0, count: 0 },
        subscriptionRevenue: subscriptionRevenue[0] || { total: 0, count: 0 },
        installationFees: installationFeeRevenue[0] || { total: 0, count: 0 },
        thisMonth: thisMonthRevenue[0] || { total: 0, count: 0 },
        pending: pendingPayments[0] || { total: 0, count: 0 },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Refund payment
// @route   POST /api/payments/:id/refund
// @access  Private/Admin
export const refundPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await paymentService.refundPayment(id, reason);
    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error: any) {
    if (error.message === "Payment not found") {
      return res.status(404).json({ message: error.message });
    }
    next(error);
  }
};

// ==================== CONFIRM PAYMENT (ADMIN ONLY) - WITH PDF ATTACHMENT ====================
export const confirmPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes, paymentType } = req.body;
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

    if (paymentType) {
      payment.paymentType = paymentType;
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
        } catch (error) {
          console.error("Error getting location:", error);
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
      } catch (error) {
        console.error("Error getting location:", error);
      }
      if (!payment.customerName || payment.customerName === "") {
        payment.customerName = customerName;
        payment.customerEmail = customerEmail;
        payment.customerPhone = customer.phoneNumber || "";
      }
    }

    // Update payment status
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
      },
      notes: payment.paymentDetails?.notes,
      isFree: payment.paymentDetails?.isFree || false,
    };
    await payment.save({ session });

    // Update billing
    const billing = await Billing.findById(payment.billingId).session(session);
    if (billing) {
      billing.status = "paid";
      billing.paymentId = payment._id;
      billing.paidAt = new Date();

      if (billing.isInstallationBill || billing.installationFee > 0) {
        billing.installationFeePaid = true;
      }
      await billing.save({ session });

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
          if (billingCycle.status === "pending_activation") {
            billingCycle.status = "active";
          }
        }

        if (
          billing.isInstallationBill ||
          (billing.installationFee && billing.installationFee > 0)
        ) {
          billingCycle.installationFeePaid = true;
        }

        await billingCycle.save({ session });
      }
    }

    // Update user
    if (payment.userId) {
      const user = await User.findById(payment.userId).session(session);
      if (user) {
        if (user.billingInfo) {
          user.billingInfo.currentBill = 0;
        }
        if (user.status === "suspended") {
          user.status = "active";
          if (user.mikrotik?.username && user.planId) {
            try {
              await mikrotikService.applyPlanToUser(user, user.planId);
            } catch (error) {
              console.error("Error reconnecting MikroTik:", error);
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
        ) {
          app.installationFeePaid = true;
        }
        await app.save({ session });
      }
    }

    await session.commitTransaction();

    // ============================================================
    // SEND PAYMENT CONFIRMATION WITH INVOICE PDF ATTACHMENT
    // ============================================================
    if (customerEmail) {
      try {
        console.log(`========================================`);
        console.log(`📧 SENDING PAYMENT CONFIRMATION WITH PDF`);
        console.log(`   To: ${customerEmail}`);
        console.log(`   Payment ID: ${payment._id}`);
        console.log(`   Amount: ₱${payment.amount}`);
        console.log(`   Location: ${location || "NONE"}`);
        console.log(`========================================`);

        // STEP 1: Find or create invoice
        let invoice = await Invoice.findOne({
          billingId: billing?._id,
          applicationId: payment.applicationId,
        }).lean();

        console.log(
          `📄 Invoice found: ${invoice ? "YES (" + invoice.invoiceNumber + ")" : "NO"}`,
        );

        // STEP 2: If no invoice exists, create one from billing data
        if (!invoice && billing) {
          console.log(`📄 Creating new invoice for payment ${payment._id}`);

          // Get application and plan for invoice
          const app = await Application.findOne({
            applicationId: payment.applicationId,
          }).lean();

          let plan = null;
          if (app?.planId) {
            plan = await Plan.findById(app.planId).lean();
          }

          // Generate invoice number
          const date = new Date();
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, "0");
          const day = date.getDate().toString().padStart(2, "0");
          const timestamp = Date.now().toString().slice(-6);
          const random = Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, "0");
          const invoiceNumberGen = `INV-${year}${month}${day}-${timestamp}${random}`;

          // Build items from billing
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
            // Create default items
            const monthlyRate = (plan as any)?.price || 0;

            // Pro-rated
            if (billing.isProRated) {
              const proRatedDays = billing.proRatedDays || 0;
              const dailyRate = (monthlyRate * 12) / 365;
              const proRatedAmount =
                Math.round(dailyRate * proRatedDays * 100) / 100;
              invoiceItems.push({
                description: `Pro-rated (${billing.billingPeriod?.start ? new Date(billing.billingPeriod.start).toLocaleDateString() : "N/A"} - ${billing.billingPeriod?.end ? new Date(billing.billingPeriod.end).toLocaleDateString() : "N/A"})`,
                quantity: proRatedDays,
                rate: dailyRate,
                amount: proRatedAmount,
                type: "pro-rated",
              });
              subtotal += proRatedAmount;
            }

            // Installation fee
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

            // Monthly subscription
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

          // Determine invoice type
          let invoiceTypeFinal = "monthly";
          const isInstallationFee =
            billing.isInstallationBill || billing.installationFee > 0;
          const isProRated = billing.isProRated || false;

          if (isInstallationFee && isProRated) {
            invoiceTypeFinal = "combined";
          } else if (isInstallationFee) {
            invoiceTypeFinal = "installation";
          } else if (isProRated) {
            invoiceTypeFinal = "pro-rated";
          }

          const total = subtotal;
          const customerAddress =
            (app as any)?.buildingName || (app as any)?.address || "N/A";
          const planName = (plan as any)?.name || "N/A";
          const collectionEmail = getCollectionEmailByLocation(location);

          // Create invoice
          const invoiceData = {
            invoiceNumber: invoiceNumberGen,
            invoiceType: invoiceTypeFinal,
            applicationId: payment.applicationId,
            userId: payment.userId,
            customerName: payment.customerName || customerName,
            customerAddress: customerAddress,
            customerEmail: customerEmail,
            customerPhone: payment.customerPhone || "",
            companyName: "Fyberblizz Network Corporation",
            companyAddress:
              "UNIT 6 BLDG 2 G/F EL PUEBLO CONDO, ANONAS ST., STA. MESA, MANILA",
            companyVat: "697-461-165-00000",
            companyContact: "0969-341-4876",
            companyEmail: collectionEmail || "admin@misterfyber.com",
            billingPeriod: {
              start: billing.billingPeriod?.start || new Date(),
              end: billing.billingPeriod?.end || new Date(),
            },
            dueDate: billing.dueDate || new Date(),
            issuedDate: new Date(),
            items: invoiceItems,
            subtotal: subtotal,
            taxRate: 0,
            taxAmount: 0,
            discountAmount: 0,
            total: total,
            bankName: "BDO",
            accountName: "FYBERBLIZZ NETWORK CORPORATION",
            accountNumber: "013448002421",
            status: "paid",
            billingId: billing._id,
            billingCycleId: billing.billingCycleId,
            isInstallationFee: isInstallationFee,
            isProRated: isProRated,
            proRatedDays: billing.proRatedDays || 0,
            planName: planName,
            notes: billing.notes || "",
            termsAndConditions:
              "Please be advised that failure to settle your account on or before the due date may result in temporary service interruption.",
            location: location || "",
            collectionEmail: collectionEmail || "admin@misterfyber.com",
            paidAt: new Date(),
            paymentId: payment._id,
          };

          invoice = await Invoice.create(invoiceData);
          invoice = invoice.toObject();
          console.log(`✅ Invoice created: ${invoice.invoiceNumber}`);
        }

        // STEP 3: If we have an invoice, generate PDF and send email
        if (invoice) {
          console.log(`📄 Using invoice: ${invoice.invoiceNumber}`);

          // Generate PDF for the invoice
          let pdfBuffer: Buffer;
          let pdfFileName = `${invoice.invoiceNumber}.pdf`;

          // Check if PDF already exists
          if (invoice.pdfUrl) {
            const filePath = path.join(__dirname, "../..", invoice.pdfUrl);
            if (fs.existsSync(filePath)) {
              pdfBuffer = fs.readFileSync(filePath);
              console.log(`📄 Using existing PDF: ${invoice.pdfUrl}`);
            } else {
              console.log(
                `📄 PDF not found at ${filePath}, generating new one`,
              );
              pdfBuffer = await generateInvoicePDF(invoice);
              const pdfDir = path.join(__dirname, "../../uploads/invoices");
              if (!fs.existsSync(pdfDir)) {
                fs.mkdirSync(pdfDir, { recursive: true });
              }
              const pdfPath = path.join(pdfDir, pdfFileName);
              fs.writeFileSync(pdfPath, pdfBuffer);
              await Invoice.findByIdAndUpdate(invoice._id, {
                pdfUrl: `/uploads/invoices/${pdfFileName}`,
                pdfGeneratedAt: new Date(),
              });
            }
          } else {
            console.log(
              `📄 Generating new PDF for invoice: ${invoice.invoiceNumber}`,
            );
            pdfBuffer = await generateInvoicePDF(invoice);
            const pdfDir = path.join(__dirname, "../../uploads/invoices");
            if (!fs.existsSync(pdfDir)) {
              fs.mkdirSync(pdfDir, { recursive: true });
            }
            const pdfPath = path.join(pdfDir, pdfFileName);
            fs.writeFileSync(pdfPath, pdfBuffer);
            await Invoice.findByIdAndUpdate(invoice._id, {
              pdfUrl: `/uploads/invoices/${pdfFileName}`,
              pdfGeneratedAt: new Date(),
            });
          }

          // STEP 4: Send payment confirmation with PDF attachment
          console.log(`📧 Sending email with PDF attachment: ${pdfFileName}`);
          console.log(`📧 PDF size: ${pdfBuffer.length} bytes`);

          // ================================================================
          // Use sendPaidInvoiceEmail for PDF attachment
          // ================================================================
          const emailSent = await emailService.sendPaidInvoiceEmail(
            invoice,
            pdfBuffer,
            pdfFileName,
            payment,
            location,
            false, // useAdminSender
          );

          if (emailSent) {
            console.log(
              `✅ Payment confirmation email sent to ${customerEmail} with invoice PDF attachment (${pdfFileName})`,
            );
          } else {
            console.warn(
              `⚠️ Failed to send payment confirmation email to ${customerEmail}`,
            );
          }
        } else {
          console.error(
            `❌ No invoice found or created for payment ${payment._id}`,
          );
        }
      } catch (emailError) {
        console.error("Error sending payment confirmation email:", emailError);
      }
    }

    const populatedPayment = await getPopulatedPayment(payment._id.toString());

    res.status(200).json({
      success: true,
      message: "Payment confirmed successfully.",
      data: populatedPayment,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// @desc    Get all payments with pending status (Admin)
// @route   GET /api/payments/admin/pending
// @access  Private/Admin
export const getPendingPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const payments = await Payment.find({ status: "pending" })
      .populate(
        "userId",
        "firstName lastName email username phoneNumber status",
      )
      .populate(
        "billingId",
        "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod",
      )
      .sort({ createdAt: -1 })
      .lean();

    const applicationIds = payments
      .filter((p) => p.applicationId)
      .map((p) => p.applicationId)
      .filter((value, index, self) => self.indexOf(value) === index);

    const applications = await Application.find({
      applicationId: { $in: applicationIds },
    }).lean();

    const applicationMap = new Map();
    applications.forEach((app) => {
      applicationMap.set(app.applicationId, app);
    });

    const enrichedPayments = payments.map((payment) => {
      const enriched: any = { ...payment };

      if (payment.applicationId && applicationMap.has(payment.applicationId)) {
        const app = applicationMap.get(payment.applicationId);
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phoneNumber: app.phoneNumber,
          status: app.status,
          serviceStatus: (app as any).serviceStatus || "pending",
          billingStarted: app.billingStarted,
          installationFee: (app as any).installationFee || 0,
          installationFeePaid: (app as any).installationFeePaid || false,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
        };
        enriched.applicationId = app.applicationId;

        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
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
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
          enriched.customerEmail = user.email || "";
          enriched.customerPhone = user.phoneNumber || "";
        }
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
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all payments with pagination (Admin)
// @route   GET /api/payments/admin/all
// @access  Private/Admin
export const getAllPaymentsAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const paymentType = req.query.paymentType as string;
    const search = req.query.search as string;
    const buildingId = req.query.buildingId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let query: any = {};
    if (status && status !== "all" && status !== "") {
      query.status = status;
    }
    if (paymentType && paymentType !== "all" && paymentType !== "") {
      query.paymentType = paymentType;
    }

    // Date range filter
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    } else if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start };
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $lte: end };
    }

    if (search) {
      query.$or = [
        { referenceNumber: { $regex: search, $options: "i" } },
        { applicationId: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerEmail: { $regex: search, $options: "i" } },
      ];
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate(
          "userId",
          "firstName lastName email username phoneNumber status buildingId",
        )
        .populate(
          "billingId",
          "invoiceNumber total dueDate isProRated isInstallationBill installationFee installationFeePaid billingPeriod",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(query),
    ]);

    // Get all building IDs from payments and users
    const buildingIds = new Set<string>();
    for (const payment of payments) {
      // Check userId.buildingId
      if (payment.userId && typeof payment.userId === "object") {
        const user = payment.userId as any;
        if (user.buildingId) {
          buildingIds.add(user.buildingId);
        }
      }
      // Check billingId for building info
      if (payment.billingId && typeof payment.billingId === "object") {
        const billing = payment.billingId as any;
        if (billing.buildingId) {
          buildingIds.add(billing.buildingId);
        }
      }
    }

    // Fetch building details
    let buildingMap = new Map();
    if (buildingIds.size > 0) {
      const buildings = await Application.aggregate([
        { $match: { buildingId: { $in: Array.from(buildingIds) } } },
        {
          $group: {
            _id: "$buildingId",
            buildingName: { $first: "$buildingName" },
          },
        },
      ]);
      buildings.forEach((b: any) => {
        buildingMap.set(b._id, b.buildingName || "Unknown Building");
      });
    }

    // If building filter is applied, filter payments by building
    let filteredPayments = payments;
    if (buildingId && buildingId !== "all" && buildingId !== "") {
      filteredPayments = payments.filter((payment) => {
        // Check if user has buildingId
        if (payment.userId && typeof payment.userId === "object") {
          const user = payment.userId as any;
          if (user.buildingId === buildingId) return true;
        }
        // Check if billing has buildingId
        if (payment.billingId && typeof payment.billingId === "object") {
          const billing = payment.billingId as any;
          if (billing.buildingId === buildingId) return true;
        }
        return false;
      });
    }

    const [
      totalStats,
      monthlyStats,
      subscriptionStats,
      installationStats,
      pendingStats,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { status: "completed" } },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1,
              ),
            },
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            paymentType: "subscription",
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            paymentType: "installation",
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "pending",
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
    ]);

    const applicationIds = filteredPayments
      .filter((p) => p.applicationId)
      .map((p) => p.applicationId)
      .filter((value, index, self) => self.indexOf(value) === index);

    let applicationMap = new Map();
    if (applicationIds.length > 0) {
      const applications = await Application.find({
        applicationId: { $in: applicationIds },
      }).lean();

      applications.forEach((app) => {
        applicationMap.set(app.applicationId, app);
      });
    }

    const enrichPaymentWithAppData = (payment: any) => {
      const enriched: any = { ...payment };

      // Add building name if available
      if (payment.userId && typeof payment.userId === "object") {
        const user = payment.userId as any;
        if (user.buildingId && buildingMap.has(user.buildingId)) {
          enriched.buildingName = buildingMap.get(user.buildingId);
        }
      }

      if (payment.applicationId && applicationMap.has(payment.applicationId)) {
        const app = applicationMap.get(payment.applicationId);
        enriched.application = {
          _id: app._id,
          applicationId: app.applicationId,
          firstName: app.firstName || "",
          lastName: app.lastName || "",
          email: app.email || "",
          phoneNumber: app.phoneNumber || "",
          status: app.status || "",
          serviceStatus: (app as any).serviceStatus || "pending",
          billingStarted: app.billingStarted || false,
          installationFee: (app as any).installationFee || 0,
          installationFeePaid: (app as any).installationFeePaid || false,
          applicantName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
          fullName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
          buildingId: (app as any).buildingId,
          buildingName: (app as any).buildingName || "",
        };
        if (!enriched.customerName || enriched.customerName === "") {
          enriched.customerName =
            `${app.firstName || ""} ${app.lastName || ""}`.trim();
          enriched.customerEmail = app.email || "";
          enriched.customerPhone = app.phoneNumber || "";
        }
        // Get building name from application
        if ((app as any).buildingName) {
          enriched.buildingName = (app as any).buildingName;
        }
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
        // Get building name from user's buildingId
        if (user.buildingId && buildingMap.has(user.buildingId)) {
          enriched.buildingName = buildingMap.get(user.buildingId);
        }
      }

      if (!enriched.customerName || enriched.customerName === "") {
        enriched.customerName = payment.applicationId || "Unknown Customer";
      }

      enriched.isInstallationPayment =
        payment.paymentType === "installation" ||
        (payment.billingId &&
          typeof payment.billingId === "object" &&
          (payment.billingId as any).isInstallationBill);

      return enriched;
    };

    const enrichedPayments = filteredPayments.map(enrichPaymentWithAppData);

    res.status(200).json({
      success: true,
      data: enrichedPayments,
      total: filteredPayments.length,
      page,
      totalPages: Math.ceil(filteredPayments.length / limit),
      stats: {
        total: totalStats[0]?.total || 0,
        totalCount: totalStats[0]?.count || 0,
        monthly: monthlyStats[0]?.total || 0,
        monthlyCount: monthlyStats[0]?.count || 0,
        subscription: subscriptionStats[0]?.total || 0,
        subscriptionCount: subscriptionStats[0]?.count || 0,
        installationFees: installationStats[0]?.total || 0,
        installationFeeCount: installationStats[0]?.count || 0,
        pending: pendingStats[0]?.total || 0,
        pendingCount: pendingStats[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error("Error in getAllPaymentsAdmin:", error);
    next(error);
  }
};

// @desc    Reject payment (Admin)
// @route   PUT /api/payments/:id/reject
// @access  Private/Admin
export const rejectPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id)
      .populate("userId", "firstName lastName email")
      .populate(
        "billingId",
        "invoiceNumber total isInstallationBill installationFee",
      )
      .lean();

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "completed") {
      return res.status(400).json({ message: "Payment already confirmed" });
    }

    if (payment.status === "failed") {
      return res.status(400).json({ message: "Payment already rejected" });
    }

    let customerEmail = "";
    let customerName = payment.customerName || "";
    let location = "";

    if (payment.applicationId) {
      const application = await Application.findOne({
        applicationId: payment.applicationId,
      }).lean();
      if (application) {
        customerEmail = application.email;
        if (!customerName || customerName === "") {
          customerName =
            `${application.firstName || ""} ${application.lastName || ""}`.trim();
        }
        try {
          location = await getLocationFromEntity(application);
        } catch (error) {
          console.error("Error getting location:", error);
        }
      }
    } else if (payment.userId) {
      const user = await User.findById(payment.userId).lean();
      if (user) {
        customerEmail = user.email;
        if (!customerName || customerName === "") {
          customerName =
            `${user.firstName || ""} ${user.lastName || ""}`.trim();
        }
        try {
          location = await getLocationFromEntity(user);
        } catch (error) {
          console.error("Error getting location:", error);
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

    // Send rejection email
    if (customerEmail) {
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

        console.log(`✅ Rejection email sent to ${customerEmail}`);
      } catch (emailError) {
        console.error("Error sending rejection email:", emailError);
      }
    }

    const responsePayment = {
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
    };

    res.status(200).json({
      success: true,
      message: "Payment rejected",
      data: responsePayment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get installation fee payment summary
// @route   GET /api/payments/installation/summary
// @access  Private/Admin
export const getInstallationPaymentSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const installationPayments = await Payment.find({
      paymentType: "installation",
      status: "completed",
    })
      .sort({ createdAt: -1 })
      .lean();

    const pendingInstallationPayments = await Payment.find({
      paymentType: "installation",
      status: "pending",
    }).lean();

    const totalInstallationRevenue = installationPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0,
    );

    const pendingTotal = pendingInstallationPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0,
    );

    const thisMonthInstallation = await Payment.aggregate([
      {
        $match: {
          paymentType: "installation",
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: totalInstallationRevenue,
        totalCount: installationPayments.length,
        pendingCount: pendingInstallationPayments.length,
        pendingTotal: pendingTotal,
        thisMonth: thisMonthInstallation[0] || { total: 0, count: 0 },
        recentPayments: installationPayments.slice(0, 10),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== DELETE PAYMENT (ADMIN ONLY) ====================
// @desc    Delete payment (Admin only)
// @route   DELETE /api/payments/:id
// @access  Private/Admin
export const deletePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id);

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Check if payment is already completed - warn but allow deletion
    const isCompleted = payment.status === "completed";

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

    // If payment is completed, also remove the payment reference from billing
    if (isCompleted && payment.billingId) {
      try {
        const billing = await Billing.findById(payment.billingId);
        if (billing) {
          billing.paymentId = undefined;
          billing.status = "pending_confirmation";
          billing.paidAt = undefined;
          if (billing.isInstallationBill || billing.installationFee > 0) {
            billing.installationFeePaid = false;
          }
          await billing.save();
        }
      } catch (error) {
        console.error("Error updating billing after payment deletion:", error);
      }
    }

    await Payment.findByIdAndDelete(id);

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

// ==================== BULK DELETE PAYMENTS (ADMIN ONLY) ====================
// @desc    Bulk delete payments by customer (Admin only)
// @route   DELETE /api/payments/bulk/customer/:customerId
// @access  Private/Admin
export const bulkDeleteCustomerPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { customerId } = req.params;
    const { deleteAll } = req.body;

    console.log(`🗑️ Bulk delete payments for customer: ${customerId}`);
    console.log(`   deleteAll: ${deleteAll}`);

    if (!customerId) {
      return res.status(400).json({ message: "Customer ID is required" });
    }

    // Build query to find all payments for this customer
    const query: any = {
      $or: [
        { applicationId: customerId },
        { customerEmail: customerId },
        { "paymentDetails.gatewayResponse.applicationId": customerId },
      ],
    };

    // If deleteAll is true, delete all payments regardless of status
    // Otherwise, only delete pending payments
    if (!deleteAll) {
      query.status = "pending";
    }

    console.log(`📋 Query:`, JSON.stringify(query, null, 2));

    const payments = await Payment.find(query);

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No payments found for customer: ${customerId}`,
      });
    }

    console.log(`📊 Found ${payments.length} payments to delete`);

    const paymentIds = payments.map((p) => p._id);
    const paymentRefs = payments.map((p) => p.referenceNumber);

    // Delete all payments
    const result = await Payment.deleteMany({ _id: { $in: paymentIds } });

    console.log(`✅ Deleted ${result.deletedCount} payments`);

    // Also update any billing records that reference these payments
    for (const payment of payments) {
      if (payment.billingId) {
        try {
          const billing = await Billing.findById(payment.billingId);
          if (billing) {
            billing.paymentId = undefined;
            billing.status = "pending_confirmation";
            billing.paidAt = undefined;
            if (billing.isInstallationBill || billing.installationFee > 0) {
              billing.installationFeePaid = false;
            }
            await billing.save();
            console.log(`🔄 Updated billing: ${billing._id}`);
          }
        } catch (error) {
          console.error("Error updating billing after bulk delete:", error);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} payments for customer ${customerId}`,
      data: {
        deletedCount: result.deletedCount,
        paymentIds: paymentIds,
        paymentRefs: paymentRefs,
      },
    });
  } catch (error) {
    console.error("Error bulk deleting customer payments:", error);
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
  rejectPayment,
  getPendingPayments,
  getAllPaymentsAdmin,
  getInstallationPaymentSummary,
  deletePayment,
  bulkDeleteCustomerPayments,
};
