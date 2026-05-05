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
}

let allRegions: any[] = [];
let allProvinces: any[] = [];
let allCities: any[] = [];
let isDataInitialized = false;

async function initializeData() {
  if (isDataInitialized) return;

  try {
    console.log("Initializing Philippine address data...");
    const [regionsRes, provincesRes, citiesRes] = await Promise.all([
      axios.get("https://psgc.gitlab.io/api/regions/"),
      axios.get("https://psgc.gitlab.io/api/provinces/"),
      axios.get("https://psgc.gitlab.io/api/cities-municipalities/"),
    ]);

    allRegions = regionsRes.data;
    allProvinces = provincesRes.data;
    allCities = citiesRes.data;
    isDataInitialized = true;
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
    const { regionCode } = req.params;

    const provinces = allProvinces
      .filter((p: any) => p.regionCode === regionCode)
      .map((province: any) => ({
        code: province.code,
        name: province.name,
      }));

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
    const { provinceCode } = req.params;

    const cities = allCities
      .filter((c: any) => c.provinceCode === provinceCode)
      .map((city: any) => ({
        code: city.code,
        name: city.name,
      }));

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
    const { cityCode } = req.params;

    const response = await axios.get(
      `https://psgc.gitlab.io/api/cities-municipalities/${cityCode}/barangays/`,
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
  if (imagePath.startsWith("data:")) {
    return imagePath;
  }
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
      return res.status(400).json({
        success: false,
        message: "Building selection is required",
      });
    }

    if (!floor) {
      return res.status(400).json({
        success: false,
        message: "Floor is required",
      });
    }

    if (!unitNumber) {
      return res.status(400).json({
        success: false,
        message: "Unit number is required",
      });
    }

    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    if (!building.isActive) {
      return res.status(400).json({
        success: false,
        message: "This building is not currently accepting applications",
      });
    }

    const existingApplication = await Application.findOne({
      email,
      status: "approved",
      registeredUserId: { $exists: false },
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message:
          "You already have an approved application. Please create your account using your application ID.",
        applicationId: existingApplication.applicationId,
      });
    }

    const pendingApplication = await Application.findOne({
      email,
      status: "pending",
    });

    if (pendingApplication) {
      return res.status(400).json({
        success: false,
        message:
          "You already have a pending application. Please wait for approval.",
      });
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
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

    await application.populate("planId");
    await application.populate("buildingId");

    const fullImageUrl = getImageUrl(application.idImage);

    // ========== SEND EMAILS - ITO ANG IMPORTANTE! ==========
    console.log("📧 Sending application received email to client...");
    await emailService.sendApplicationReceived(application, application.planId);

    console.log("📧 Sending new application notification to admin...");
    await emailService.sendNewApplicationNotification(
      application,
      application.planId,
    );
    // =======================================================

    res.status(201).json({
      success: true,
      message:
        "Application submitted successfully. You will receive an email once approved.",
      data: {
        applicationId: application.applicationId,
        status: application.status,
        idImageUrl: fullImageUrl,
        plan: {
          name: (application.planId as any).name,
          price: (application.planId as any).price,
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
      .populate("planId", "name price speed")
      .populate(
        "buildingId",
        "buildingName streetAddress barangay city province region zipCode",
      );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
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

export const getAllApplications = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    let query: any = {};
    if (status) {
      query.status = status;
    }

    const applications = await Application.find(query)
      .populate("planId", "name price")
      .populate("buildingId", "buildingName streetAddress city")
      .populate("reviewedBy", "firstName lastName email")
      .populate("registeredUserId", "username email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Application.countDocuments(query);

    const applicationsWithUrls = applications.map((app) => ({
      ...app.toObject(),
      idImageUrl: getImageUrl(app.idImage),
    }));

    res.status(200).json({
      success: true,
      data: applicationsWithUrls,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total,
    });
  } catch (error) {
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
      .populate("planId", "name price speed duration features")
      .populate(
        "buildingId",
        "buildingName streetAddress region province city barangay zipCode",
      )
      .populate("reviewedBy", "firstName lastName email");

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const idImageUrl = getImageUrl(application.idImage);

    res.status(200).json({
      success: true,
      data: {
        ...application.toObject(),
        idImageUrl: idImageUrl,
      },
    });
  } catch (error) {
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
    const application = await Application.findById(req.params.id).populate(
      "planId",
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (application.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Application already ${application.status}`,
      });
    }

    application.status = "approved";
    application.adminNotes = adminNotes || "";
    application.reviewedBy = req.user?._id || null;
    application.reviewedAt = new Date();
    await application.save();

    // ========== SEND APPROVAL EMAIL TO CLIENT ==========
    console.log(`📧 Sending approval email to ${application.email}...`);
    await emailService.sendApplicationApproved(
      application,
      application.planId as any,
    );
    // ===================================================

    res.status(200).json({
      success: true,
      message: "Application approved successfully. Email sent to client.",
      data: {
        applicationId: application.applicationId,
        status: application.status,
      },
    });
  } catch (error) {
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
    const application = await Application.findById(req.params.id).populate(
      "planId",
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (application.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Application already ${application.status}`,
      });
    }

    application.status = "rejected";
    application.adminNotes = adminNotes || "";
    application.reviewedBy = req.user?._id || null;
    application.reviewedAt = new Date();
    await application.save();

    // ========== SEND REJECTION EMAIL TO CLIENT ==========
    console.log(`📧 Sending rejection email to ${application.email}...`);
    await emailService.sendApplicationRejected(
      application,
      adminNotes || "No specific reason provided",
    );
    // ====================================================

    res.status(200).json({
      success: true,
      message: "Application rejected. Email sent to client.",
      data: {
        applicationId: application.applicationId,
        status: application.status,
      },
    });
  } catch (error) {
    next(error);
  }
};
