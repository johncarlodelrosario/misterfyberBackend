import { Request, Response, NextFunction } from "express";
import Application from "../models/Application";
import Plan from "../models/Plan";
import Building from "../models/Building";
import emailService from "../services/emailService";
import { validationResult } from "express-validator";
import axios from "axios";

interface AuthRequest extends Request {
  user?: any;
  file?: any;
  body: any;
  params: any;
  query: any;
}

// OPTIMIZED: Cache for address data
let allRegions: any[] = [];
let allProvinces: any[] = [];
let allCities: any[] = [];
let isDataInitialized = false;
let lastCacheUpdate = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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
    // OPTIMIZED: Cache control headers
    res.setHeader("Cache-Control", "public, max-age=86400"); // 24 hours
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
      notes,
      planId,
      idType,
      idNumber,
      hasFile: !!req.file,
    });

    if (!buildingId) {
      return res
        .status(400)
        .json({ success: false, message: "Building selection is required" });
    }
    if (!floor) {
      return res
        .status(400)
        .json({ success: false, message: "Floor is required" });
    }
    if (!unitNumber) {
      return res
        .status(400)
        .json({ success: false, message: "Unit number is required" });
    }

    // OPTIMIZED: Parallel queries
    const [building, plan, existingApplication, pendingApplication] =
      await Promise.all([
        Building.findById(buildingId).lean(),
        Plan.findById(planId).lean(),
        Application.findOne({
          email,
          status: "approved",
          registeredUserId: { $exists: false },
        }).lean(),
        Application.findOne({ email, status: "pending" }).lean(),
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
      firstName,
      lastName,
      email,
      phoneNumber,
      buildingId: building._id,
      buildingName: building.buildingName,
      floor,
      unitNumber,
      notes: notes || "",
      planId,
      idType,
      idNumber,
      idImage: idImagePath,
      status: "pending",
    };

    const application = new Application(applicationData);
    await application.save();

    // OPTIMIZED: Use lean() for faster population
    const populatedApp = await Application.findById(application._id)
      .populate("planId")
      .populate("buildingId")
      .lean();

    const fullImageUrl = getImageUrl(application.idImage);

    console.log("📧 Sending application received email to client...");
    await emailService.sendApplicationReceived(application, application.planId);

    console.log("📧 Sending new application notification to admin...");
    await emailService.sendNewApplicationNotification(
      application,
      application.planId,
    );

    res.status(201).json({
      success: true,
      message:
        "Application submitted successfully. You will receive an email once approved.",
      data: {
        applicationId: application.applicationId,
        status: application.status,
        idImageUrl: fullImageUrl,
        plan: {
          name: (populatedApp?.planId as any)?.name,
          price: (populatedApp?.planId as any)?.price,
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
    // OPTIMIZED: Use lean() and select only needed fields
    const application = await Application.findOne({ applicationId })
      .select(
        "applicationId status idImage floor unitNumber notes createdAt adminNotes",
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
      },
    });
  } catch (error) {
    next(error);
  }
};

// OPTIMIZED: Added caching headers, lean queries, and pagination
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

    // OPTIMIZED: Cache control headers
    res.setHeader("Cache-Control", "private, max-age=30"); // 30 seconds cache
    res.setHeader("Vary", "Accept-Encoding");

    // OPTIMIZED: Parallel queries for better performance
    const [total, applications] = await Promise.all([
      Application.countDocuments(query),
      Application.find(query)
        .select(
          "applicationId firstName lastName email phoneNumber status createdAt idImage",
        )
        .populate("planId", "name price")
        .populate("buildingId", "buildingName streetAddress city")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec(), // Added exec() for better performance
    ]);

    const applicationsWithUrls = applications.map((app) => ({
      ...app,
      idImageUrl: getImageUrl(app.idImage),
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
    // OPTIMIZED: Use lean() and select only needed fields
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

export const approveApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { adminNotes } = req.body;

    // OPTIMIZED: Use lean() for initial check
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

    // OPTIMIZED: Use updateOne for better performance
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
    );

    console.log(`📧 Sending approval email to ${application.email}...`);
    await emailService.sendApplicationApproved(
      application,
      application.planId as any,
    );

    res.status(200).json({
      success: true,
      message: "Application approved successfully. Email sent to client.",
      data: {
        applicationId: application.applicationId,
        status: "approved",
      },
    });
  } catch (error) {
    console.error("Error in approveApplication:", error);
    next(error);
  }
};

export const rejectApplication = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { adminNotes } = req.body;

    // OPTIMIZED: Use lean() for initial check
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

    // OPTIMIZED: Use updateOne for better performance
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
};
