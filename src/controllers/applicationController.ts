// controllers/applicationController.ts - COMPLETE FILE WITH AUTO-BILLING ON APPROVAL
import { Request, Response, NextFunction } from "express";
import Application from "../models/Application";
import Plan from "../models/Plan";
import Building from "../models/Building";
import User from "../models/User";
import emailService from "../services/emailService";
import { validationResult } from "express-validator";
import axios from "axios";
import mongoose from "mongoose";
import { startBilling as startBillingService } from "./billingController";

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

const getImageUrl = (imagePath: string): string => {
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

    const [building, plan, existingApplication, pendingApplication] =
      await Promise.all([
        Building.findById(buildingId)
          .lean()
          .catch(() => null),
        Plan.findById(planId)
          .lean()
          .catch(() => null),
        Application.findOne({
          email,
          status: "approved",
          registeredUserId: { $exists: false },
        })
          .lean()
          .catch(() => null),
        Application.findOne({ email, status: "pending" })
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

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message:
          "You already have an approved application. Please create your account using your application ID.",
        applicationId: existingApplication.applicationId,
      });
    }

    if (pendingApplication) {
      return res.status(400).json({
        success: false,
        message:
          "You already have a pending application. Please wait for approval.",
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
      email: email?.trim().toLowerCase(),
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

    console.log("📊 Plan details for email:", {
      planId: application.planId,
      populatedPlanName: populatedPlan?.name,
      populatedPlanPrice: populatedPlan?.price,
    });

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
        "applicationId status idImage floor unitNumber notes createdAt adminNotes billingStarted",
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
          "applicationId firstName lastName email phoneNumber status createdAt idImage billingStarted registeredUserId",
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

// MODIFIED: Approve application with auto-account creation and auto-billing
export const approveApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { adminNotes, startBillingImmediately = true } = req.body;

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

    const plan = application.planId as any;

    // Generate credentials for the user
    const generatedPassword = Math.random().toString(36).slice(-8);
    const username =
      `${application.firstName.toLowerCase()}.${application.lastName.toLowerCase()}`.replace(
        /[^a-z0-9.]/g,
        "",
      );
    let finalUsername = username;
    let counter = 1;
    while (await User.findOne({ username: finalUsername })) {
      finalUsername = `${username}${counter}`;
      counter++;
    }

    // Create user account automatically
    const user = await User.create(
      [
        {
          username: finalUsername,
          email: application.email,
          password: generatedPassword,
          firstName: application.firstName,
          lastName: application.lastName,
          phoneNumber: application.phoneNumber,
          buildingId: application.buildingId,
          buildingName: application.buildingName,
          floor: application.floor,
          unitNumber: application.unitNumber,
          planId: application.planId,
          status: startBillingImmediately ? "pending_activation" : "active",
          idType: application.idType,
          idNumber: application.idNumber,
          idImage: application.idImage,
          mikrotik: {
            username: finalUsername,
            password: generatedPassword,
            profile: plan?.mikrotikProfile || "default",
            ipAddress: "",
            macAddress: "",
          },
          billingInfo: {
            currentBill: 0,
            autoPay: false,
          },
        },
      ],
      { session },
    );

    const userDoc = user[0];

    // Update application
    await Application.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: "approved",
          adminNotes: adminNotes || "",
          reviewedBy: req.user?._id || null,
          reviewedAt: new Date(),
          registeredUserId: userDoc._id,
        },
      },
      { session },
    );

    let billingResult = null;

    // Start billing automatically if requested
    if (startBillingImmediately && plan) {
      const billingReq = {
        body: {
          userId: userDoc._id,
          notes: `Auto-started on application approval`,
        },
        user: req.user,
      } as any;

      const billingRes = {
        status: (code: number) => ({
          json: (data: any) => {
            billingResult = data;
            return data;
          },
        }),
      } as any;

      await startBillingService(billingReq, billingRes, next);
    }

    await session.commitTransaction();

    // Send approval email with credentials
    const loginUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/login`;

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
          <p>Great news! Your application to Mister Fyber has been approved. Your account has been automatically created.</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Your Account Details:</h3>
            <p><strong>Application ID:</strong> ${application.applicationId}</p>
            <p><strong>Username:</strong> ${finalUsername}</p>
            <p><strong>Password:</strong> ${generatedPassword}</p>
            <p><strong>Plan:</strong> ${plan?.name || "N/A"}</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px;">
              Login to Your Account
            </a>
          </div>
          
          <p><strong>Important:</strong> Please change your password after your first login.</p>
          ${startBillingImmediately ? `<p>Your billing has been automatically started. You will receive a separate email with your first invoice.</p>` : ""}
          ${adminNotes ? `<div style="margin-top: 20px; padding: 10px; background-color: #e7f3ff; border-left: 4px solid #007bff;"><strong>Admin Notes:</strong><br>${adminNotes}</div>` : ""}
          
          <hr>
          <p style="color: #666; font-size: 12px;">Mister Fyber - Your trusted internet provider</p>
        </div>
      </body>
      </html>
    `;

    await emailService.sendEmail(
      application.email,
      `Application Approved - Welcome to Mister Fyber!`,
      emailHtml,
    );

    console.log(`✅ Application approved: ${application.applicationId}`);
    console.log(`📧 Approval email sent to: ${application.email}`);
    if (startBillingImmediately) {
      console.log(
        `💰 Billing started automatically for user: ${userDoc.email}`,
      );
    }

    res.status(200).json({
      success: true,
      message: startBillingImmediately
        ? "Application approved. User account created and billing started successfully!"
        : "Application approved. User account created successfully!",
      data: {
        applicationId: application.applicationId,
        status: "approved",
        user: {
          id: userDoc._id,
          username: finalUsername,
          email: userDoc.email,
        },
        credentials: {
          username: finalUsername,
          password: generatedPassword,
        },
        billing: billingResult?.data || null,
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

    console.log(`📧 Sending rejection email to ${application.email}...`);
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

// NEW: Start billing for an existing approved application
export const startBillingForApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
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

    let userId = application.registeredUserId;

    // If no user account exists yet, create one
    if (!userId) {
      const plan = application.planId as any;
      const generatedPassword = Math.random().toString(36).slice(-8);
      const username =
        `${application.firstName.toLowerCase()}.${application.lastName.toLowerCase()}`.replace(
          /[^a-z0-9.]/g,
          "",
        );
      let finalUsername = username;
      let counter = 1;
      while (await User.findOne({ username: finalUsername })) {
        finalUsername = `${username}${counter}`;
        counter++;
      }

      const user = await User.create({
        username: finalUsername,
        email: application.email,
        password: generatedPassword,
        firstName: application.firstName,
        lastName: application.lastName,
        phoneNumber: application.phoneNumber,
        buildingId: application.buildingId,
        buildingName: application.buildingName,
        floor: application.floor,
        unitNumber: application.unitNumber,
        planId: application.planId,
        status: "pending_activation",
        idType: application.idType,
        idNumber: application.idNumber,
        idImage: application.idImage,
        mikrotik: {
          username: finalUsername,
          password: generatedPassword,
          profile: plan?.mikrotikProfile || "default",
          ipAddress: "",
          macAddress: "",
        },
        billingInfo: {
          currentBill: 0,
          autoPay: false,
        },
      });

      userId = user._id;
      await Application.updateOne(
        { _id: application._id },
        { $set: { registeredUserId: userId } },
      );

      // Send credentials email
      const loginUrl = `${process.env.FRONTEND_URL || "https://www.misterfyber.com"}/login`;
      await emailService.sendEmail(
        application.email,
        "Your Mister Fyber Account Details",
        `
          <h2>Your Account Has Been Created!</h2>
          <p>Dear ${application.firstName},</p>
          <p>Your account has been created. Here are your credentials:</p>
          <p><strong>Username:</strong> ${finalUsername}</p>
          <p><strong>Password:</strong> ${generatedPassword}</p>
          <p><strong>Application ID:</strong> ${application.applicationId}</p>
          <a href="${loginUrl}">Click here to login</a>
        `,
      );
    }

    // Start billing
    const billingReq = {
      body: {
        userId: userId.toString(),
        startDate: installationDate,
        notes:
          notes ||
          `Billing started for application ${application.applicationId}`,
      },
      user: req.user,
    } as any;

    const billingRes = {
      status: (code: number) => ({
        json: (data: any) => data,
      }),
    } as any;

    const result = await startBillingService(billingReq, billingRes, next);

    // Mark application as billing started
    await Application.updateOne(
      { _id: application._id },
      { $set: { billingStarted: true } },
    );

    res.status(200).json({
      success: true,
      message: "Billing started successfully for this application!",
      data: result,
    });
  } catch (error) {
    console.error("Error in startBillingForApplication:", error);
    next(error);
  }
};

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
