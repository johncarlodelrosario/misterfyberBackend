import { Request, Response, NextFunction } from "express";
import Application from "../models/Application";
import Plan from "../models/Plan";
import Building from "../models/Building";
import User from "../models/User";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import emailService from "../services/emailService";
import { validationResult } from "express-validator";
import axios from "axios";
import mongoose from "mongoose";

interface AuthRequest extends Request {
  user?: any;
  file?: any;
  body: any;
  params: any;
  query: any;
}

let allRegions: any[] = [];
let allProvinces: any[] = [];
let allCities: any[] = [];
let isDataInitialized = false;
let lastCacheUpdate = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000;

async function initializeData() {
  const now = Date.now();
  if (isDataInitialized && now - lastCacheUpdate < CACHE_DURATION) return;

  try {
    console.log("Initializing Philippine address data...");
    const [regionsRes, provincesRes, citiesRes] = await Promise.all([
      axios.get("https://psgc.gitlab.io/api/regions/", { timeout: 10000 }),
      axios.get("https://psgc.gitlab.io/api/provinces/", { timeout: 10000 }),
      axios.get("https://psgc.gitlab.io/api/cities-municipalities/", {
        timeout: 10000,
      }),
    ]);

    allRegions = regionsRes.data;
    allProvinces = provincesRes.data;
    allCities = citiesRes.data;
    isDataInitialized = true;
    lastCacheUpdate = now;
    console.log(
      `Loaded ${allRegions.length} regions, ${allProvinces.length} provinces, ${allCities.length} cities`,
    );
  } catch (error) {
    console.error("Error initializing address data:", error);
    throw error;
  }
}

export const getRegions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await initializeData();
    res.setHeader("Cache-Control", "public, max-age=86400");
    const regions = allRegions.map((region: any) => ({
      code: region.code,
      name: region.name,
    }));
    res.status(200).json({ success: true, data: regions });
  } catch (error) {
    console.error("Error fetching regions:", error);
    next(error);
  }
};

export const getProvincesByRegion = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await initializeData();
    res.setHeader("Cache-Control", "public, max-age=86400");
    const { regionCode } = req.params;
    const provinces = allProvinces
      .filter((p: any) => p.regionCode === regionCode)
      .map((province: any) => ({ code: province.code, name: province.name }));
    res.status(200).json({ success: true, data: provinces });
  } catch (error) {
    console.error("Error fetching provinces:", error);
    next(error);
  }
};

export const getCitiesByProvince = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await initializeData();
    res.setHeader("Cache-Control", "public, max-age=86400");
    const { provinceCode } = req.params;
    const cities = allCities
      .filter((c: any) => c.provinceCode === provinceCode)
      .map((city: any) => ({ code: city.code, name: city.name }));
    res.status(200).json({ success: true, data: cities });
  } catch (error) {
    console.error("Error fetching cities:", error);
    next(error);
  }
};

export const getBarangaysByCity = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.setHeader("Cache-Control", "public, max-age=86400");
    const { cityCode } = req.params;
    const response = await axios.get(
      `https://psgc.gitlab.io/api/cities-municipalities/${cityCode}/barangays/`,
      { timeout: 10000 },
    );
    const barangays = response.data.map((barangay: any) => ({
      name: barangay.name,
    }));
    res.status(200).json({ success: true, data: barangays });
  } catch (error) {
    console.error("Error fetching barangays:", error);
    next(error);
  }
};

const getImageUrl = (imagePath?: string): string => {
  if (!imagePath) return "";
  if (
    imagePath.includes("cloudinary.com") ||
    imagePath.startsWith("https://res.cloudinary.com")
  ) {
    return imagePath;
  }
  if (imagePath.startsWith("data:")) return imagePath;
  const PRODUCTION_URL = "https://misterfyberbackend.onrender.com";
  let filename = "";
  const parts = imagePath.split(/[\\\/]/);
  filename = parts[parts.length - 1];
  if (!filename || filename === "placeholder.jpg") {
    return `${PRODUCTION_URL}/uploads/id-cards/placeholder.jpg`;
  }
  return `${PRODUCTION_URL}/uploads/id-cards/${filename}`;
};

export const submitApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    let {
      firstName,
      lastName,
      email,
      phoneNumber,
      buildingId,
      floor,
      unitNumber,
      notes,
      planId,
      idType,
      idNumber,
    } = req.body;

    console.log("Received application data:", {
      firstName,
      lastName,
      email,
      phoneNumber,
      buildingId,
      floor,
      unitNumber,
      planId,
    });

    if (!buildingId || buildingId === "undefined" || buildingId === "null") {
      return res
        .status(400)
        .json({ success: false, message: "Building selection is required" });
    }
    if (!floor || floor === "undefined" || floor === "null") {
      return res
        .status(400)
        .json({ success: false, message: "Floor is required" });
    }
    if (!unitNumber || unitNumber === "undefined" || unitNumber === "null") {
      return res
        .status(400)
        .json({ success: false, message: "Unit number is required" });
    }
    if (!planId || planId === "undefined" || planId === "null") {
      return res
        .status(400)
        .json({ success: false, message: "Plan selection is required" });
    }

    const normalizedEmail = email?.trim().toLowerCase();

    const existingApplication = await Application.findOne({
      email: normalizedEmail,
      status: { $in: ["pending", "approved", "rejected"] },
    }).lean();

    if (existingApplication) {
      let message = "";
      if (existingApplication.status === "pending") {
        message =
          "You already have a pending application. Please wait for approval.";
      } else if (existingApplication.status === "approved") {
        message =
          "You already have an approved application. Please create your account using your application ID.";
      } else if (existingApplication.status === "rejected") {
        message =
          "Your previous application was rejected. Please contact support for assistance.";
      }

      return res.status(400).json({
        success: false,
        message: message,
        applicationId: existingApplication.applicationId,
        status: existingApplication.status,
      });
    }

    const [building, plan] = await Promise.all([
      Building.findById(buildingId)
        .lean()
        .catch(() => null),
      Plan.findById(planId)
        .lean()
        .catch(() => null),
    ]);

    if (!building) {
      return res
        .status(404)
        .json({ success: false, message: "Building not found" });
    }
    if (!building.isActive) {
      return res.status(400).json({
        success: false,
        message: "This building is not currently accepting applications",
      });
    }

    if (!plan) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    let idImagePath = "uploads/id-cards/placeholder.jpg";
    if (req.file) {
      if (req.file.path) {
        idImagePath = req.file.path;
        console.log(`📁 File uploaded: ${idImagePath}`);
      } else if (req.file.buffer) {
        idImagePath = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      }
    }

    const applicationData = {
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      email: normalizedEmail,
      phoneNumber: phoneNumber?.trim(),
      buildingId: building._id,
      buildingName: building.buildingName,
      floor: floor?.toString().trim(),
      unitNumber: unitNumber?.toString().trim(),
      notes: notes || "",
      planId,
      idType: idType?.trim(),
      idNumber: idNumber?.trim(),
      idImage: idImagePath,
      status: "pending",
    };

    const application = new Application(applicationData);
    await application.save();

    const populatedApplication = await Application.findById(application._id)
      .populate("planId")
      .populate("buildingId")
      .lean();

    const fullImageUrl = getImageUrl(application.idImage);
    const populatedPlan = populatedApplication?.planId as any;

    try {
      console.log("📧 Sending application received email to client...");
      await emailService.sendApplicationReceived(application, populatedPlan);
    } catch (emailError) {
      console.error("Failed to send client email:", emailError);
    }

    try {
      console.log("📧 Sending new application notification to admin...");
      await emailService.sendNewApplicationNotification(
        application,
        populatedPlan,
      );
    } catch (emailError) {
      console.error("Failed to send admin email:", emailError);
    }

    const planPrice = populatedPlan?.price;
    const safePrice =
      planPrice !== undefined && planPrice !== null ? planPrice : 0;

    res.status(201).json({
      success: true,
      message:
        "Application submitted successfully. You will receive an email once approved.",
      data: {
        applicationId: application.applicationId,
        status: application.status,
        idImageUrl: fullImageUrl,
        plan: {
          name: populatedPlan?.name || "N/A",
          price: safePrice,
        },
        building: {
          name: building.buildingName,
          address: `${building.streetAddress}, ${building.barangay}, ${building.city}`,
        },
      },
    });
  } catch (error: any) {
    console.error("Application submission error:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: Object.values(error.errors).map((err: any) => err.message),
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate application detected. Please try again.",
      });
    }
    next(error);
  }
};

export const checkApplicationStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;
    const application = await Application.findOne({ applicationId })
      .select(
        "applicationId status idImage floor unitNumber notes createdAt adminNotes billingStarted billingCycleId registeredUserId",
      )
      .populate("planId", "name price speed")
      .populate(
        "buildingId",
        "buildingName streetAddress barangay city province region zipCode",
      )
      .lean();

    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const idImageUrl = getImageUrl(application.idImage);
    res.status(200).json({
      success: true,
      data: {
        applicationId: application.applicationId,
        status: application.status,
        idImageUrl: idImageUrl,
        plan: application.planId,
        building: application.buildingId,
        floor: application.floor,
        unitNumber: application.unitNumber,
        notes: application.notes,
        createdAt: application.createdAt,
        adminNotes: application.adminNotes,
        billingStarted: application.billingStarted || false,
        hasAccount: !!application.registeredUserId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAllApplications = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};
    if (status && status !== "all") query.status = status;

    res.setHeader("Cache-Control", "private, max-age=30");
    res.setHeader("Vary", "Accept-Encoding");

    const [total, applications] = await Promise.all([
      Application.countDocuments(query),
      Application.find(query)
        .select(
          "applicationId firstName lastName email phoneNumber status createdAt idImage billingStarted registeredUserId billingCycleId",
        )
        .populate("planId", "name price")
        .populate("buildingId", "buildingName streetAddress city")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec(),
    ]);

    const applicationsWithUrls = applications.map((app) => ({
      ...app,
      idImageUrl: getImageUrl(app.idImage),
      hasAccount: !!app.registeredUserId,
    }));

    res.status(200).json({
      success: true,
      data: applicationsWithUrls,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      total,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Error in getAllApplications:", error);
    next(error);
  }
};

export const getApplication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const application = await Application.findById(req.params.id)
      .select("-__v")
      .populate("planId", "name price speed duration features")
      .populate(
        "buildingId",
        "buildingName streetAddress region province city barangay zipCode",
      )
      .populate("reviewedBy", "firstName lastName email")
      .lean()
      .exec();

    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const idImageUrl = getImageUrl(application.idImage);
    res
      .status(200)
      .json({ success: true, data: { ...application, idImageUrl } });
  } catch (error) {
    console.error("Error in getApplication:", error);
    next(error);
  }
};

// ==================== APPROVE APPLICATION - BILLING CAN START BEFORE USER CREATES ACCOUNT ====================
export const approveApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { adminNotes, startBillingNow } = req.body;

    const application = await Application.findById(req.params.id).populate(
      "planId",
    );

    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    if (application.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Application already ${application.status}`,
      });
    }

    // Update application status
    await Application.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: "approved",
          adminNotes: adminNotes || "",
          reviewedBy: req.user?._id || null,
          reviewedAt: new Date(),
        },
      },
      { session },
    );

    await session.commitTransaction();

    // Send approval email WITH application ID for registration
    const registerUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/register`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Application Approved - Mister Fyber</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #28a745;">✅ Application Approved!</h2>
          <p>Dear ${application.firstName} ${application.lastName},</p>
          <p>Great news! Your application to Mister Fyber has been approved.</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Your Application Details:</h3>
            <p><strong>Application ID:</strong> ${application.applicationId}</p>
            <p><strong>Plan:</strong> ${(application.planId as any)?.name || "N/A"}</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${registerUrl}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
              Create Your Account Now
            </a>
          </div>
          
          <p><strong>Important:</strong> You need to create your account using your Application ID.</p>
          
          ${adminNotes ? `<div style="margin-top: 20px; padding: 10px; background-color: #e7f3ff; border-left: 4px solid #007bff;"><strong>Admin Notes:</strong><br>${adminNotes}</div>` : ""}
          
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>
      </body>
      </html>
    `;

    await emailService.sendEmail(
      application.email,
      `Application Approved - Create Your Account`,
      emailHtml,
    );

    console.log(`✅ Application approved: ${application.applicationId}`);
    console.log(`📧 Approval email sent to: ${application.email}`);

    res.status(200).json({
      success: true,
      message:
        "Application approved. Customer can now register using their Application ID.",
      data: {
        applicationId: application.applicationId,
        status: "approved",
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error in approveApplication:", error);
    next(error);
  } finally {
    session.endSession();
  }
};

export const rejectApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { adminNotes } = req.body;

    const application = await Application.findById(req.params.id).populate(
      "planId",
    );

    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    if (application.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Application already ${application.status}`,
      });
    }

    await Application.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: "rejected",
          adminNotes: adminNotes || "",
          reviewedBy: req.user?._id || null,
          reviewedAt: new Date(),
        },
      },
    );

    await emailService.sendApplicationRejected(
      application,
      adminNotes || "No specific reason provided",
    );

    res.status(200).json({
      success: true,
      message: "Application rejected. Email sent to client.",
      data: {
        applicationId: application.applicationId,
        status: "rejected",
      },
    });
  } catch (error) {
    console.error("Error in rejectApplication:", error);
    next(error);
  }
};

// ==================== START BILLING FOR APPLICATION - BILLING BEFORE USER ACCOUNT ====================
export const startBillingForApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { applicationId } = req.params;
    const { installationDate, notes } = req.body;

    const application = await Application.findOne({ applicationId })
      .populate("planId")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (application.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: `Cannot start billing for application with status: ${application.status}. Only approved applications can start billing.`,
      });
    }

    if (application.billingStarted) {
      return res.status(400).json({
        success: false,
        message: "Billing has already been started for this application",
      });
    }

    const plan = application.planId as any;
    const monthlyRate = plan.price;
    const annualRate = monthlyRate * 12;
    const dailyRate = annualRate / 365;

    const billingCutoffDay = 24;
    let installationDateObj = installationDate
      ? new Date(installationDate)
      : new Date();
    installationDateObj.setHours(0, 0, 0, 0);

    const installationDay = installationDateObj.getDate();
    const currentMonthEnd = new Date(
      installationDateObj.getFullYear(),
      installationDateObj.getMonth() + 1,
      0,
    );
    currentMonthEnd.setHours(23, 59, 59, 999);

    const daysInMonth = currentMonthEnd.getDate();
    const actualBillableDays = daysInMonth - installationDay + 1;
    const isAfterCutoff = installationDay > billingCutoffDay;

    let proRatedAmount = Math.round(dailyRate * actualBillableDays * 100) / 100;
    let billingStartDateForCycle: Date;
    let billingEndDateForCycle: Date;
    let nextBillingDate: Date;
    let dueDate: Date;
    let billItems: any[] = [];
    let totalAmount: number;
    let isCombinedBill = false;

    const settings = {
      proRatedDueDay: 25,
      monthlyDueDay: 5,
    };

    if (isAfterCutoff) {
      // Combined bill: pro-rated + next month
      isCombinedBill = true;
      billingStartDateForCycle = new Date(
        installationDateObj.getFullYear(),
        installationDateObj.getMonth() + 1,
        1,
      );
      billingStartDateForCycle.setHours(0, 0, 0, 0);
      billingEndDateForCycle = new Date(
        billingStartDateForCycle.getFullYear(),
        billingStartDateForCycle.getMonth() + 1,
        0,
      );
      billingEndDateForCycle.setHours(23, 59, 59, 999);
      nextBillingDate = new Date(
        billingStartDateForCycle.getFullYear(),
        billingStartDateForCycle.getMonth() + 1,
        1,
      );

      dueDate = new Date(billingStartDateForCycle);
      dueDate.setMonth(dueDate.getMonth() + 1);
      let targetDay = settings.monthlyDueDay;
      const lastDayOfMonth = new Date(
        dueDate.getFullYear(),
        dueDate.getMonth() + 1,
        0,
      ).getDate();
      if (targetDay > lastDayOfMonth) targetDay = lastDayOfMonth;
      dueDate.setDate(targetDay);
      dueDate.setHours(23, 59, 59, 999);

      totalAmount = monthlyRate + proRatedAmount;

      billItems = [
        {
          description: `Pro-rated payment from ${installationDateObj.toLocaleDateString()} to ${currentMonthEnd.toLocaleDateString()} (${actualBillableDays} days)`,
          quantity: actualBillableDays,
          rate: dailyRate,
          amount: proRatedAmount,
        },
        {
          description: `Monthly Subscription - ${billingStartDateForCycle.toLocaleDateString()} to ${billingEndDateForCycle.toLocaleDateString()}`,
          quantity: 1,
          rate: monthlyRate,
          amount: monthlyRate,
        },
      ];
    } else {
      // Pro-rated only bill
      billingStartDateForCycle = installationDateObj;
      billingEndDateForCycle = currentMonthEnd;
      nextBillingDate = new Date(
        installationDateObj.getFullYear(),
        installationDateObj.getMonth() + 1,
        1,
      );

      dueDate = new Date(installationDateObj);
      let targetDay = settings.proRatedDueDay;
      const lastDayOfMonth = new Date(
        dueDate.getFullYear(),
        dueDate.getMonth() + 1,
        0,
      ).getDate();
      if (targetDay > lastDayOfMonth) targetDay = lastDayOfMonth;
      dueDate.setDate(targetDay);
      dueDate.setHours(23, 59, 59, 999);

      if (dueDate < installationDateObj) {
        dueDate = currentMonthEnd;
      }

      totalAmount = proRatedAmount;

      billItems = [
        {
          description: `Pro-rated payment from ${installationDateObj.toLocaleDateString()} to ${currentMonthEnd.toLocaleDateString()} (${actualBillableDays} days)`,
          quantity: actualBillableDays,
          rate: dailyRate,
          amount: proRatedAmount,
        },
      ];
    }

    // Create billing cycle
    const billingCycle = await BillingCycle.create(
      [
        {
          userId: null, // No user yet - will be linked when user registers
          planId: plan._id,
          billingStartDate: billingStartDateForCycle,
          billingEndDate: billingEndDateForCycle,
          nextBillingDate: nextBillingDate,
          status: "pending_activation",
          monthlyRate: monthlyRate,
          currentProRatedAmount: proRatedAmount,
          proRatedPaid: false,
          actualBillableDays: actualBillableDays,
          isAfterCutoff: isAfterCutoff,
          cutoffDayUsed: billingCutoffDay,
          applicationId: application._id,
        },
      ],
      { session },
    );

    // Create bill
    const invoiceNumber = `INV-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, "0")}-${Date.now().toString().slice(-6)}${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, "0")}`;

    const bill = await Billing.create(
      [
        {
          userId: null, // No user yet - will be linked when user registers
          billingCycleId: billingCycle[0]._id,
          invoiceNumber: invoiceNumber,
          billingPeriod: {
            start: installationDateObj,
            end: billingEndDateForCycle,
          },
          dueDate: dueDate,
          items: billItems,
          subtotal: totalAmount,
          tax: 0,
          discount: 0,
          total: totalAmount,
          status: "sent",
          isProRated: true,
          proRatedDays: actualBillableDays,
          notes:
            notes ||
            (isCombinedBill
              ? `Combined bill due on ${dueDate.toLocaleDateString()}`
              : `Pro-rated bill due on ${dueDate.toLocaleDateString()}`),
          applicationId: application._id,
        },
      ],
      { session },
    );

    // Update application with billing info
    await Application.updateOne(
      { _id: application._id },
      {
        $set: {
          billingStarted: true,
          billingCycleId: billingCycle[0]._id,
        },
      },
      { session },
    );

    await session.commitTransaction();

    // Send email with bill information (no account credentials yet)
    await emailService.sendBillWithoutAccount(application, bill[0], plan);

    clearAllCache();

    res.status(200).json({
      success: true,
      message: isCombinedBill
        ? `Billing started! Combined bill (pro-rated + next month) of ₱${totalAmount.toFixed(2)} due on ${dueDate.toLocaleDateString()}. Customer can register using their Application ID.`
        : `Billing started! Pro-rated bill of ₱${totalAmount.toFixed(2)} due on ${dueDate.toLocaleDateString()}. Customer can register using their Application ID.`,
      data: {
        billingCycle: billingCycle[0],
        bill: bill[0],
        proRatedAmount: proRatedAmount,
        monthlyRate: monthlyRate,
        actualBillableDays: actualBillableDays,
        isAfterCutoff: isAfterCutoff,
        dueDate: dueDate,
        nextBillingDate: nextBillingDate,
        isCombinedBill: isCombinedBill,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error in startBillingForApplication:", error);
    next(error);
  } finally {
    session.endSession();
  }
};

// Clear cache helper
let billingSettingsCache: any = null;
let billingSettingsCacheTime = 0;
let billingCyclesCache: Map<string, { data: any; timestamp: number }> =
  new Map();
let billsCache: Map<string, { data: any; timestamp: number }> = new Map();
let summaryCache: { data: any; timestamp: number } | null = null;

function clearAllCache(): void {
  billingSettingsCache = null;
  billingCyclesCache.clear();
  billsCache.clear();
  summaryCache = null;
  console.log("🗑️ Billing cache cleared");
}

export default {
  getRegions,
  getProvincesByRegion,
  getCitiesByProvince,
  getBarangaysByCity,
  submitApplication,
  checkApplicationStatus,
  getAllApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  startBillingForApplication,
};
