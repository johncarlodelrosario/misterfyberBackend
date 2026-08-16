// routes/applicationRoutes.ts - COMPLETE WITH ALL ENDPOINTS
import express, { Router, Request, Response, NextFunction } from "express";
import { body } from "express-validator";
import {
  submitApplication,
  checkApplicationStatus,
  getAllApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  getRegions,
  getProvincesByRegion,
  getCitiesByProvince,
  getBarangaysByCity,
  startBillingForApplication,
  getApplicationDashboardData,
  getApplicationStats,
  clearApplicationCache,
} from "../controllers/applicationController";
import { protect, authorize } from "../middleware/auth";
import { uploadIdCard } from "../middleware/upload";
import Application from "../models/Application";
import mongoose from "mongoose";

const router: Router = Router();

console.log("🔄 Registering application routes...");

// ============ PUBLIC ROUTES ============
router.get("/address/regions", getRegions);
router.get("/address/provinces/:regionCode", getProvincesByRegion);
router.get("/address/cities/:provinceCode", getCitiesByProvince);
router.get("/address/barangays/:cityCode", getBarangaysByCity);

router.post(
  "/",
  uploadIdCard.single("idImage"),
  [
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
    body("buildingId").notEmpty().withMessage("Please select a building"),
    body("tower")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("Tower must be a string"),
    body("floor").notEmpty().withMessage("Floor is required"),
    body("unitNumber").notEmpty().withMessage("Unit number is required"),
    body("planId").notEmpty().withMessage("Plan is required"),
    body("idType").notEmpty().withMessage("ID type is required"),
    body("idNumber").notEmpty().withMessage("ID number is required"),
  ],
  submitApplication,
);

router.get("/status/:applicationId", checkApplicationStatus);

// ============ PROTECTED ROUTES ============
router.use(protect);
router.use(authorize("super_admin", "admin", "staff"));

// ============ DASHBOARD ENDPOINTS ============
router.get("/dashboard/data", getApplicationDashboardData);
router.get("/dashboard/stats", getApplicationStats);

// ============ GET ALL APPLICATIONS - WITH PAGINATION ============
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log("📊 Application route / called");

    if (mongoose.connection.readyState !== 1) {
      console.error("❌ MongoDB not connected!");
      return res.status(503).json({
        success: false,
        message: "Database connection unavailable",
        data: [],
        total: 0,
        totalPages: 0,
        currentPage: 1,
        limit: 20,
      });
    }

    await getAllApplications(req, res, next);
  } catch (error: any) {
    console.error("❌ Route error:", error);
    res.status(200).json({
      success: true,
      data: [],
      totalPages: 0,
      currentPage: 1,
      total: 0,
      limit: 20,
      _error: true,
      message: error.message || "Error loading applications",
    });
  }
});

// ============ GET ALL APPLICATIONS - NO LIMIT (ALL DATA) ============
router.get("/all", async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log("📊 Application route /all called - fetching ALL data");

    if (mongoose.connection.readyState !== 1) {
      console.error("❌ MongoDB not connected!");
      return res.status(503).json({
        success: false,
        message: "Database connection unavailable",
        data: [],
        total: 0,
      });
    }

    // Fetch ALL applications without pagination limit
    const applications = await Application.find()
      .sort({ createdAt: -1 })
      .lean();

    const total = applications.length;

    console.log(`✅ Found ${total} total applications`);

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
      idImageUrl: app.idImage ? getImageUrl(app.idImage) : "",
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
      plan: app.planId,
      building: app.buildingId,
    }));

    return res.status(200).json({
      success: true,
      data: formattedData,
      total: total,
      message: `All ${total} applications fetched successfully`,
    });
  } catch (error: any) {
    console.error("❌ Error fetching all applications:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching all applications",
      error: error.message || "Unknown error",
    });
  }
});

// Helper function (moved from controller)
function getImageUrl(imagePath?: string): string {
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
}

// ============ SINGLE APPLICATION ============
router.get("/:id", getApplication);

// ============ APPROVE / REJECT ============
router.put("/:id/approve", approveApplication);
router.put("/:id/reject", rejectApplication);

// ============ START BILLING ============
router.post("/:applicationId/start-billing", startBillingForApplication);

// ============ INLINE EDIT ROUTES ============
router.patch("/:id/mac-address", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { macAddress } = req.body;

    const application = await Application.findByIdAndUpdate(
      id,
      { macAddress: macAddress || "" },
      { new: true },
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    clearApplicationCache();

    res.status(200).json({
      success: true,
      data: {
        macAddress: application.macAddress,
        applicationId: application.applicationId,
      },
    });
  } catch (error) {
    console.error("Error updating MAC address:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating MAC address",
    });
  }
});

router.patch("/:id/tower", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tower } = req.body;

    const application = await Application.findByIdAndUpdate(
      id,
      { tower: tower || "" },
      { new: true },
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    clearApplicationCache();

    res.status(200).json({
      success: true,
      data: {
        tower: application.tower,
        applicationId: application.applicationId,
      },
    });
  } catch (error) {
    console.error("Error updating tower:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating tower",
    });
  }
});

// ============ CLEAR CACHE ============
router.post("/cache/clear", (req: Request, res: Response) => {
  clearApplicationCache();
  res.status(200).json({ success: true, message: "Cache cleared" });
});

// ============ TEST ROUTES ============
router.get("/test/direct", async (req: Request, res: Response) => {
  try {
    console.log("🧪 TEST ROUTE 1: Direct database query");

    const total = await Application.countDocuments();
    console.log(`📊 Total applications: ${total}`);

    const apps = await Application.find()
      .limit(5)
      .select("applicationId firstName lastName email status createdAt")
      .lean();

    console.log(`📋 Found ${apps.length} applications`);

    res.status(200).json({
      success: true,
      total,
      sample: apps,
      message: "Direct database query successful",
    });
  } catch (error) {
    console.error("❌ Test route error:", error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

router.get("/test/simple", async (req: Request, res: Response) => {
  try {
    console.log("🧪 TEST ROUTE 2: Simple pagination");

    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [apps, total] = await Promise.all([
      Application.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select(
          "applicationId firstName lastName email status createdAt buildingName",
        )
        .lean(),
      Application.countDocuments(),
    ]);

    console.log(`📋 Found ${apps.length} applications, Total: ${total}`);

    res.status(200).json({
      success: true,
      data: apps,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("❌ Test route error:", error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

console.log("✅ Application routes registered");

export default router;
