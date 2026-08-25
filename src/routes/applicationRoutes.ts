// routes/applicationRoutes.ts - COMPLETE FIXED WITH TYPE SAFETY
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
  getAllApplications,
  getAllApplicationsNoLimit,
} from "../controllers/applicationController";
import { protect, authorize } from "../middleware/auth";
import { uploadIdCard } from "../middleware/upload";
import Application from "../models/Application";
import mongoose from "mongoose";
import NodeCache from "node-cache";

const router: Router = Router();

// ✅ CACHE FOR ROUTE
const routeCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

console.log("🔄 Registering application routes...");

// ============ HELPER FUNCTION ============
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

// ============ GET ALL APPLICATIONS - WITH CACHE ============
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // ✅ CHECK CACHE MUNA!
    const cacheKey = `applications_page_${pageNum}_limit_${limitNum}_status_${status || "all"}`;
    const cachedData = routeCache.get(cacheKey) as {
      success: boolean;
      data: any[];
      totalPages: number;
      currentPage: number;
      total: number;
      limit: number;
      _responseTime: string;
    } | null;

    if (cachedData) {
      console.log(`📦 Returning cached applications page ${pageNum}`);
      return res.status(200).json(cachedData);
    }

    console.log(
      `📊 Application route / called - page: ${pageNum}, limit: ${limitNum}`,
    );

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

    const filter: any = {};
    if (status && status !== "all") {
      filter.status = status;
    }

    // ✅ USE estimatedDocumentCount() - SUPER FAST!
    const [applications, total] = await Promise.all([
      Application.find(filter)
        .select(
          "applicationId firstName lastName email phoneNumber status createdAt idImage billingStarted registeredUserId billingCycleId idType idNumber tower floor unitNumber macAddress buildingId buildingName installationFee installationFeePaid serviceStatus",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.estimatedDocumentCount(),
    ]);

    const elapsed = Date.now() - startTime;
    console.log(
      `✅ Found ${applications.length} applications, Total: ${total} in ${elapsed}ms`,
    );

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
      _responseTime: `${elapsed}ms`,
    };

    // ✅ CACHE FOR 30 SECONDS
    routeCache.set(cacheKey, responseData, 30);

    return res.status(200).json(responseData);
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
      _responseTime: `${Date.now() - startTime}ms`,
    });
  }
});

// ============ GET ALL APPLICATIONS - NO LIMIT (WITH CACHE) ============
router.get("/all", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const cacheKey = "all_applications_no_limit";
    const cachedData = routeCache.get(cacheKey) as {
      data: any[];
      total: number;
    } | null;

    if (cachedData) {
      console.log("📦 Returning cached all applications data");
      return res.status(200).json({
        success: true,
        data: cachedData.data,
        total: cachedData.total,
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

    const applications = await Application.find()
      .select(
        "applicationId firstName lastName email phoneNumber status createdAt idImage billingStarted registeredUserId billingCycleId idType idNumber tower floor unitNumber macAddress buildingId buildingName installationFee installationFeePaid serviceStatus",
      )
      .sort({ createdAt: -1 })
      .lean();

    const total = applications.length;

    console.log(
      `✅ Found ${total} total applications in ${Date.now() - startTime}ms`,
    );

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
      planId: app.planId,
      plan: null,
      building: null,
    }));

    const cacheData = { data: formattedData, total: total };
    routeCache.set(cacheKey, cacheData, 60);

    return res.status(200).json({
      success: true,
      data: formattedData,
      total: total,
      _responseTime: `${Date.now() - startTime}ms`,
    });
  } catch (error: any) {
    console.error("❌ Error fetching all applications:", error.message);

    const cachedData = routeCache.get("all_applications_no_limit") as {
      data: any[];
      total: number;
    } | null;

    if (cachedData) {
      console.log("📦 Returning expired cached data due to error");
      return res.status(200).json({
        success: true,
        data: cachedData.data,
        total: cachedData.total,
        cached: true,
        error: "Using cached data due to database timeout",
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    return res.status(200).json({
      success: true,
      data: [],
      total: 0,
      _responseTime: `${Date.now() - startTime}ms`,
      error: "Database timeout - please refresh",
    });
  }
});

// ============ CLEAR CACHE ON UPDATE ============
router.post("/cache/clear", (req: Request, res: Response) => {
  routeCache.flushAll();
  clearApplicationCache();
  res.status(200).json({ success: true, message: "All cache cleared" });
});

// ============ DELETE APPLICATION - CLEAR CACHE ============
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

    // ✅ CLEAR CACHE!
    routeCache.flushAll();
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

// ============ BULK DELETE - CLEAR CACHE ============
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

    // ✅ CLEAR CACHE!
    routeCache.flushAll();
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

    // ✅ CLEAR CACHE!
    routeCache.flushAll();
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

    // ✅ CLEAR CACHE!
    routeCache.flushAll();
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

    const total = await Application.estimatedDocumentCount();
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
      Application.estimatedDocumentCount(),
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
