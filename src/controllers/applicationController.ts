// controllers/applicationController.ts - COMPLETE FIXED VERSION
import { Request, Response, NextFunction } from "express";
import Application from "../models/Application";
import Plan from "../models/Plan";
import Building from "../models/Building";
import User from "../models/User";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import emailService from "../services/emailService";
import { validationResult, ValidationError } from "express-validator";
import axios from "axios";
import mongoose from "mongoose";
import NodeCache from "node-cache";

// ============ CACHE SETUP ============
const appCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

// ============ DASHBOARD CACHE ============
let dashboardCache: any = null;
let dashboardCacheTime = 0;
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000;

// ============ ADDRESS DATA CACHE ============
let allRegions: any[] = [];
let allProvinces: any[] = [];
let allCities: any[] = [];
let isDataInitialized = false;
let lastCacheUpdate = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000;

interface AuthRequest extends Request {
  user?: any;
  file?: any;
  body: any;
  params: any;
  query: any;
}

// ============ ADDRESS DATA FUNCTIONS ============
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

// ============ ADDRESS ENDPOINTS ============
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

// ============ HELPERS ============
export const getImageUrl = (imagePath?: string): string => {
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

// ============ GET ALL APPLICATIONS (PAGINATED) ============
export const getAllApplications = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = Date.now();

  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    console.log(
      `🔄 getAllApplications - page: ${pageNum}, limit: ${limitNum}, status: ${status || "all"}`,
    );

    // Build filter
    const filter: any = {};
    if (status && status !== "all") {
      filter.status = status;
    }

    // Fetch applications with lean for performance
    const applications = await Application.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Application.countDocuments(filter);

    console.log(
      `✅ Found ${applications.length} applications, Total: ${total}`,
    );

    // Format response
    const formattedData = applications.map((app: any) => ({
      _id: app._id,
      applicationId: app.applicationId,
      firstName: app.firstName,
      lastName: app.lastName,
      email: app.email,
      phoneNumber: app.phoneNumber,
      status: app.status,
      createdAt: app.createdAt,
      idImage: app.idImage,
      idImageUrl: getImageUrl(app.idImage),
      billingStarted: app.billingStarted || false,
      registeredUserId: app.registeredUserId,
      billingCycleId: app.billingCycleId,
      idType: app.idType,
      idNumber: app.idNumber,
      tower: app.tower || "",
      floor: app.floor,
      unitNumber: app.unitNumber,
      macAddress: app.macAddress || "",
      buildingId: app.buildingId,
      buildingName: app.buildingName,
      hasAccount: !!app.registeredUserId,
      installationFee: app.installationFee || 0,
      installationFeePaid: app.installationFeePaid || false,
      serviceStatus: app.serviceStatus || "pending",
      plan: null,
      building: null,
    }));

    const responseData = {
      success: true,
      data: formattedData,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      total: total || 0,
      limit: limitNum,
      _responseTime: `${Date.now() - startTime}ms`,
    };

    console.log(`✅ Response sent in ${Date.now() - startTime}ms`);

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("❌ Error in getAllApplications:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching applications",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ============ DASHBOARD DATA ============
export const getApplicationDashboardData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();

    if (dashboardCache && now - dashboardCacheTime < DASHBOARD_CACHE_TTL) {
      console.log("📦 Returning cached application dashboard data");
      return res.status(200).json({
        success: true,
        data: dashboardCache,
      });
    }

    console.log("🔄 Fetching fresh application dashboard data...");

    const [
      totalApplications,
      pendingApplications,
      approvedApplications,
      rejectedApplications,
      suspendedApplications,
      totalUsers,
      totalBuildings,
      totalPlans,
      recentApplications,
    ] = await Promise.all([
      Application.estimatedDocumentCount(),
      Application.countDocuments({ status: "pending" }),
      Application.countDocuments({ status: "approved" }),
      Application.countDocuments({ status: "rejected" }),
      Application.countDocuments({ status: "suspended" }),
      User.estimatedDocumentCount(),
      Building.countDocuments({ isActive: true }),
      Plan.countDocuments({ isActive: true }),
      Application.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select(
          "applicationId firstName lastName email status createdAt buildingName",
        )
        .lean(),
    ]);

    // Get by building - simple grouping
    const allApps = await Application.find()
      .select("buildingName status planId")
      .lean();
    const plans = await Plan.find().select("name").lean();
    const planMap: Record<string, string> = {};
    plans.forEach((p: any) => {
      planMap[p._id.toString()] = p.name;
    });

    const buildingCount: Record<string, number> = {};
    const planCount: Record<string, number> = {};
    const monthlyCount: Record<string, number> = {};
    const statusCount: Record<string, number> = {};

    allApps.forEach((app: any) => {
      const bName = app.buildingName || "Unknown";
      buildingCount[bName] = (buildingCount[bName] || 0) + 1;

      const pName = planMap[app.planId?.toString()] || "Unknown";
      planCount[pName] = (planCount[pName] || 0) + 1;

      const d = new Date(app.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyCount[key] = (monthlyCount[key] || 0) + 1;

      const s = app.status || "unknown";
      statusCount[s] = (statusCount[s] || 0) + 1;
    });

    const applicationsByBuilding = Object.entries(buildingCount)
      .map(([name, count]) => ({ _id: name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const applicationsByPlan = Object.entries(planCount)
      .map(([name, count]) => ({ _id: name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const monthlyApplications = Object.entries(monthlyCount)
      .map(([month, count]) => ({
        _id: {
          year: parseInt(month.split("-")[0]),
          month: parseInt(month.split("-")[1]),
        },
        count,
      }))
      .sort((a, b) => {
        if (a._id.year !== b._id.year) return b._id.year - a._id.year;
        return b._id.month - a._id.month;
      })
      .slice(0, 12);

    const statusDistribution = Object.entries(statusCount).map(
      ([status, count]) => ({ _id: status, count }),
    );

    const stats = {
      totalApplications,
      pendingApplications,
      approvedApplications,
      rejectedApplications,
      suspendedApplications,
      totalUsers,
      totalBuildings,
      totalPlans,
      approvalRate:
        totalApplications > 0
          ? Math.round((approvedApplications / totalApplications) * 100)
          : 0,
      pendingRate:
        totalApplications > 0
          ? Math.round((pendingApplications / totalApplications) * 100)
          : 0,
      rejectedRate:
        totalApplications > 0
          ? Math.round((rejectedApplications / totalApplications) * 100)
          : 0,
      statusDistribution,
    };

    const dashboardData = {
      stats,
      recentApplications,
      applicationsByBuilding,
      applicationsByPlan,
      monthlyApplications,
      lastUpdated: new Date().toISOString(),
    };

    dashboardCache = dashboardData;
    dashboardCacheTime = now;

    console.log(`✅ Application dashboard cached`);

    res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error("Error in getApplicationDashboardData:", error);
    next(error);
  }
};

// ============ QUICK STATS ============
export const getApplicationStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const [total, pending, approved, rejected, suspended] = await Promise.all([
      Application.estimatedDocumentCount(),
      Application.countDocuments({ status: "pending" }),
      Application.countDocuments({ status: "approved" }),
      Application.countDocuments({ status: "rejected" }),
      Application.countDocuments({ status: "suspended" }),
    ]);

    const stats = {
      totalApplications: total,
      pending,
      approved,
      rejected,
      suspended,
      approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      pendingRate: total > 0 ? Math.round((pending / total) * 100) : 0,
      rejectedRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
    };

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error("Error in getApplicationStats:", error);
    next(error);
  }
};

// ============ SUBMIT APPLICATION ============
export const submitApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      session.endSession();

      const errorMessages = errors.array().map((err: ValidationError) => {
        if (err.type === "field") {
          return {
            field: err.path,
            message: err.msg,
            value: err.value,
          };
        }
        return {
          message: err.msg,
        };
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errorMessages,
      });
    }

    let {
      firstName,
      lastName,
      email,
      phoneNumber,
      buildingId,
      tower,
      floor,
      unitNumber,
      notes,
      planId,
      idType,
      idNumber,
      macAddress,
    } = req.body;

    if (!tower || tower === "undefined" || tower === "null") {
      tower = "";
    }

    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhoneNumber = phoneNumber?.trim();

    // Check existing user
    const existingUser = await User.findOne({
      email: normalizedEmail,
    }).lean();

    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "This email address is already registered as a user.",
        alreadyRegistered: true,
        email: normalizedEmail,
      });
    }

    // Check existing application by email
    const existingApplicationByEmail = await Application.findOne({
      email: normalizedEmail,
    }).lean();

    if (existingApplicationByEmail) {
      let message = "";
      let statusCode = 400;

      switch (existingApplicationByEmail.status) {
        case "pending":
          message =
            "You already have a pending application. Please wait for approval.";
          break;
        case "approved":
          message =
            "You already have an approved application. Please create your account using your Application ID.";
          statusCode = 409;
          break;
        case "rejected":
          message =
            "Your previous application was rejected. Please contact support for assistance.";
          statusCode = 403;
          break;
        case "suspended":
          message = "Your account is suspended. Please contact support.";
          statusCode = 403;
          break;
        default:
          message =
            "You already have an existing application. Please check your status.";
      }

      await session.abortTransaction();
      session.endSession();
      return res.status(statusCode).json({
        success: false,
        message: message,
        applicationId: existingApplicationByEmail.applicationId,
        status: existingApplicationByEmail.status,
      });
    }

    // Check existing application by phone
    const existingApplicationByPhone = await Application.findOne({
      phoneNumber: normalizedPhoneNumber,
    }).lean();

    if (existingApplicationByPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "This phone number is already associated with an existing application.",
        applicationId: existingApplicationByPhone.applicationId,
        status: existingApplicationByPhone.status,
      });
    }

    // Check duplicate unit
    const existingActiveServiceQuery: any = {
      buildingId: new mongoose.Types.ObjectId(buildingId),
      floor: floor?.toString().trim(),
      unitNumber: unitNumber?.toString().trim(),
      status: { $in: ["approved", "pending"] },
    };

    if (tower && tower.toString().trim()) {
      existingActiveServiceQuery.tower = tower.toString().trim();
    }

    const existingActiveService = await Application.findOne(
      existingActiveServiceQuery,
    ).lean();

    if (existingActiveService) {
      const towerMsg = tower ? `Tower ${tower} - ` : "";
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: `Unit ${towerMsg}${floor}-${unitNumber} already has an active or pending application.`,
      });
    }

    // Get building and plan
    const [building, plan] = await Promise.all([
      Building.findById(buildingId)
        .lean()
        .catch(() => null),
      Plan.findById(planId)
        .lean()
        .catch(() => null),
    ]);

    if (!building) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Building not found" });
    }
    if (!building.isActive) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "This building is not currently accepting applications",
      });
    }

    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    // Handle file upload
    let idImagePath = "uploads/id-cards/placeholder.jpg";
    if (req.file) {
      if (req.file.path) {
        idImagePath = req.file.path;
        console.log(`📁 File uploaded: ${idImagePath}`);
      } else if (req.file.buffer) {
        idImagePath = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
          "base64",
        )}`;
      }
    }

    // Create application
    const applicationData = {
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      email: normalizedEmail,
      phoneNumber: normalizedPhoneNumber,
      buildingId: building._id,
      buildingName: building.buildingName,
      tower: tower?.toString().trim() || "",
      floor: floor?.toString().trim(),
      unitNumber: unitNumber?.toString().trim(),
      notes: notes || "",
      planId,
      idType: idType?.trim() || "Not Provided",
      idNumber: idNumber?.trim() || "Not Provided",
      idImage: idImagePath,
      macAddress: macAddress?.trim() || "",
      status: "pending",
    };

    console.log("📝 Creating application with auto-generated ID...");
    const application = new Application(applicationData);

    await application.save({ session });

    console.log(`✅ Application created with ID: ${application.applicationId}`);

    const populatedApplication = await Application.findById(application._id)
      .populate("planId")
      .populate("buildingId")
      .session(session)
      .lean();

    await session.commitTransaction();
    session.endSession();

    // Clear cache
    appCache.flushAll();
    dashboardCache = null;
    dashboardCacheTime = 0;

    const fullImageUrl = getImageUrl(application.idImage);
    const populatedPlan = populatedApplication?.planId as any;

    // Send emails (non-blocking)
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
    await session.abortTransaction();
    session.endSession();
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
        message:
          "Duplicate application detected. This email or application ID already exists.",
      });
    }
    next(error);
  }
};

// ============ CHECK APPLICATION STATUS ============
export const checkApplicationStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { applicationId } = req.params;
    const application = await Application.findOne({ applicationId })
      .select(
        "applicationId status idImage tower floor unitNumber notes createdAt adminNotes billingStarted billingCycleId registeredUserId firstName lastName email phoneNumber idType idNumber macAddress buildingId buildingName",
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
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phoneNumber: application.phoneNumber,
        idType: application.idType,
        idNumber: application.idNumber,
        macAddress: application.macAddress || "",
        plan: application.planId,
        building: application.buildingId,
        buildingName: application.buildingName,
        tower: application.tower || "",
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
    console.error("Error in checkApplicationStatus:", error);
    next(error);
  }
};

// ============ GET SINGLE APPLICATION ============
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
        "buildingName streetAddress region province city barangay zipCode isActive",
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
    res.status(200).json({
      success: true,
      data: {
        ...application,
        idImageUrl,
        macAddress: application.macAddress || "",
        tower: application.tower || "",
        building: application.buildingId,
      },
    });
  } catch (error) {
    console.error("Error in getApplication:", error);
    next(error);
  }
};

// ============ APPROVE APPLICATION ============
export const approveApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { adminNotes } = req.body;

    const application = await Application.findById(req.params.id).populate(
      "planId",
    );

    if (!application) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    if (application.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Application already ${application.status}`,
      });
    }

    await Application.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: "approved",
          adminNotes: adminNotes || "",
          reviewedBy: req.user?._id || null,
          reviewedAt: new Date(),
          approvalEmailSent: true,
        },
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    appCache.flushAll();
    dashboardCache = null;
    dashboardCacheTime = 0;

    const plan = application.planId as any;
    await emailService.sendApplicationApproved(application, plan);

    console.log(`✅ Application approved: ${application.applicationId}`);

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
    session.endSession();
    console.error("Error in approveApplication:", error);
    next(error);
  }
};

// ============ REJECT APPLICATION ============
export const rejectApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { adminNotes } = req.body;

    const application = await Application.findById(req.params.id).populate(
      "planId",
    );

    if (!application) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }
    if (application.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
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
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    appCache.flushAll();
    dashboardCache = null;
    dashboardCacheTime = 0;

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
    await session.abortTransaction();
    session.endSession();
    console.error("Error in rejectApplication:", error);
    next(error);
  }
};

// ============ START BILLING ============
export const startBillingForApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let { applicationId } = req.params;
    const { installationDate, notes } = req.body;

    console.log(`🔍 Looking for application with ID: ${applicationId}`);

    let application = null;

    if (mongoose.Types.ObjectId.isValid(applicationId)) {
      console.log(`📌 Attempt 1: Find by MongoDB _id: ${applicationId}`);
      application = await Application.findById(applicationId)
        .populate("planId")
        .session(session)
        .lean();
    }

    if (!application) {
      console.log(
        `📌 Attempt 2: Find by string applicationId field: ${applicationId}`,
      );
      application = await Application.findOne({
        applicationId: applicationId,
      })
        .populate("planId")
        .session(session)
        .lean();
    }

    if (!application) {
      console.log(`📌 Attempt 3: Find by email or phone`);
      application = await Application.findOne({
        $or: [{ email: applicationId }, { phoneNumber: applicationId }],
      })
        .populate("planId")
        .session(session)
        .lean();
    }

    if (!application) {
      await session.abortTransaction();
      session.endSession();
      console.error(`❌ Application NOT FOUND for ID: ${applicationId}`);
      return res.status(404).json({
        success: false,
        message: `Application not found with ID: ${applicationId}.`,
      });
    }

    console.log(
      `✅ Found application: ${application.applicationId} - ${application.firstName} ${application.lastName}`,
    );

    if (application.status !== "approved") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot start billing for application with status: ${application.status}. Only approved applications can start billing.`,
      });
    }

    // Check existing billing cycle
    const existingBillingCycle = await BillingCycle.findOne({
      applicationId: application.applicationId,
    })
      .session(session)
      .lean();

    if (existingBillingCycle) {
      await session.abortTransaction();
      session.endSession();
      const statusMessages: Record<string, string> = {
        active: "active and running",
        paused: "paused",
        pending_activation: "pending payment confirmation",
        cancelled: "cancelled",
      };

      return res.status(400).json({
        success: false,
        message: `Billing has already been started for this application. Current status: ${statusMessages[existingBillingCycle.status] || existingBillingCycle.status}`,
        data: {
          billingCycle: existingBillingCycle,
          status: existingBillingCycle.status,
          startDate: existingBillingCycle.billingStartDate,
          nextBillingDate: existingBillingCycle.nextBillingDate,
        },
      });
    }

    const existingBills = await Billing.findOne({
      applicationId: application.applicationId,
    })
      .session(session)
      .lean();

    if (existingBills) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "This application already has billing records. Please check the billing history.",
        data: { hasBills: true },
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

    const billingCycle = await BillingCycle.create(
      [
        {
          userId: null,
          applicationId: application.applicationId,
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
        },
      ],
      { session },
    );

    const invoiceNumber = `INV-${new Date().getFullYear()}${(
      new Date().getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}-${Date.now().toString().slice(-6)}${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, "0")}`;

    const bill = await Billing.create(
      [
        {
          userId: null,
          applicationId: application.applicationId,
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
          isProRated: !isCombinedBill,
          proRatedDays: actualBillableDays,
          notes:
            notes ||
            (isCombinedBill
              ? `Combined bill due on ${dueDate.toLocaleDateString()}`
              : `Pro-rated bill due on ${dueDate.toLocaleDateString()}`),
        },
      ],
      { session },
    );

    await Application.updateOne(
      { _id: application._id },
      {
        $set: {
          billingStarted: true,
          billingCycleId: billingCycle[0]._id,
          serviceStatus: "pending",
        },
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    appCache.flushAll();
    dashboardCache = null;
    dashboardCacheTime = 0;

    await emailService.sendBillWithoutAccount(application, bill[0], plan);

    res.status(200).json({
      success: true,
      message: isCombinedBill
        ? `Billing started! Combined bill (pro-rated + next month) of ₱${totalAmount.toFixed(2)} due on ${dueDate.toLocaleDateString()}. Application ID: ${application.applicationId}`
        : `Billing started! Pro-rated bill of ₱${totalAmount.toFixed(2)} due on ${dueDate.toLocaleDateString()}. Application ID: ${application.applicationId}`,
      data: {
        applicationId: application.applicationId,
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
    session.endSession();
    console.error("Error in startBillingForApplication:", error);
    next(error);
  }
};

// ============ CLEAR CACHE ============
export const clearApplicationCache = () => {
  appCache.flushAll();
  dashboardCache = null;
  dashboardCacheTime = 0;
  console.log("🗑️ Application cache cleared");
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
  getApplicationDashboardData,
  getApplicationStats,
  clearApplicationCache,
};
