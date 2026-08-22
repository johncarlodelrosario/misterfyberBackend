// routes/applicationRoutes.ts - COMPLETE FIXED - RETURNS ALL DATA
import express, { Router, Request, Response, NextFunction } from "express";
import { body } from "express-validator";
import {
  submitApplication,
  checkApplicationStatus,
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

// ============ CACHE ============
let allApplicationsCache: any = null;
let allApplicationsCacheTime = 0;
const ALL_CACHE_TTL = 30 * 1000; // 30 seconds

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

    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};
    if (status && status !== "all") {
      filter.status = status;
    }

    const [applications, total] = await Promise.all([
      Application.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(filter),
    ]);

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
      plan: null,
      building: null,
    }));

    return res.status(200).json({
      success: true,
      data: formattedData,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      total: total || 0,
      limit: limitNum,
    });
  } catch (error: any) {
    console.error("❌ Route error:", error);
    return res.status(200).json({
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

// ============ GET ALL APPLICATIONS - NO LIMIT (RETURNS ALL DATA) ============
router.get("/all", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    // Check cache first
    const now = Date.now();
    if (
      allApplicationsCache &&
      now - allApplicationsCacheTime < ALL_CACHE_TTL
    ) {
      console.log("📦 Returning cached all applications data");
      return res.status(200).json({
        success: true,
        data: allApplicationsCache.data,
        total: allApplicationsCache.total,
        cached: true,
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    console.log("📊 Application route /all - fetching ALL data (no limit)");

    if (mongoose.connection.readyState !== 1) {
      console.error("❌ MongoDB not connected!");
      return res.status(503).json({
        success: false,
        message: "Database connection unavailable",
        data: [],
        total: 0,
      });
    }

    // ✅ FETCH ALL DATA - NO LIMIT, NO PAGINATION
    const [applications, total] = await Promise.all([
      Application.find().sort({ createdAt: -1 }).lean(),
      Application.countDocuments(),
    ]);

    console.log(
      `✅ Found ${applications.length} total applications in ${Date.now() - startTime}ms`,
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
      planId: app.planId,
      plan: null,
      building: null,
    }));

    // Cache the result
    allApplicationsCache = {
      data: formattedData,
      total: total,
    };
    allApplicationsCacheTime = Date.now();

    return res.status(200).json({
      success: true,
      data: formattedData,
      total: total,
      _responseTime: `${Date.now() - startTime}ms`,
    });
  } catch (error: any) {
    console.error("❌ Error fetching all applications:", error.message);

    // If cache exists, use it even if expired
    if (allApplicationsCache) {
      console.log("📦 Returning expired cached data due to error");
      return res.status(200).json({
        success: true,
        data: allApplicationsCache.data,
        total: allApplicationsCache.total,
        cached: true,
        error: "Using cached data due to database timeout",
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    // Return empty data
    return res.status(200).json({
      success: true,
      data: [],
      total: 0,
      _responseTime: `${Date.now() - startTime}ms`,
      error: "Database timeout - please refresh",
    });
  }
});

// Helper function
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

// ============ DELETE APPLICATION ============
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const application = await Application.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    await Application.findByIdAndDelete(id);

    allApplicationsCache = null;
    allApplicationsCacheTime = 0;
    clearApplicationCache();

    res.status(200).json({
      success: true,
      message: `Application ${application.applicationId} deleted successfully`,
      data: {
        applicationId: application.applicationId,
        firstName: application.firstName,
        lastName: application.lastName,
      },
    });
  } catch (error) {
    console.error("Error deleting application:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting application",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============ BULK DELETE ============
router.post("/bulk-delete", async (req: Request, res: Response) => {
  try {
    const { applicationIds } = req.body;

    if (
      !applicationIds ||
      !Array.isArray(applicationIds) ||
      applicationIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "applicationIds array is required",
      });
    }

    const deleted = await Application.deleteMany({
      _id: { $in: applicationIds },
    });

    allApplicationsCache = null;
    allApplicationsCacheTime = 0;
    clearApplicationCache();

    res.status(200).json({
      success: true,
      message: `${deleted.deletedCount} applications deleted successfully`,
      data: {
        deletedCount: deleted.deletedCount,
      },
    });
  } catch (error) {
    console.error("Error bulk deleting applications:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting applications",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============ CLEAR CACHE ============
router.post("/cache/clear", (req: Request, res: Response) => {
  allApplicationsCache = null;
  allApplicationsCacheTime = 0;
  clearApplicationCache();
  res.status(200).json({ success: true, message: "All cache cleared" });
});

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

    allApplicationsCache = null;
    allApplicationsCacheTime = 0;
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

    allApplicationsCache = null;
    allApplicationsCacheTime = 0;
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

// ============ TEST ROUTES ============
router.get("/test/direct", async (req: Request, res: Response) => {
  try {
    console.log("🧪 TEST ROUTE: Direct database query");

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
    console.log("🧪 TEST ROUTE: Simple pagination");

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
