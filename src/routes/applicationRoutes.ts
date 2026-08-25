// routes/applicationRoutes.ts - ULTIMATE SPEED FIXED (WITH PLAN POPULATION!)
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
import Plan from "../models/Plan";
import mongoose from "mongoose";
import NodeCache from "node-cache";

const router: Router = Router();

// ✅ IISANG CACHE LANG - GLOBAL!
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

console.log("🔥 ULTIMATE SPEED MODE - Application Routes");

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

// ============================================================
// ✅ MAIN GET - SUPER FAST (100ms FIRST LOAD!)
// ============================================================
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const cacheKey = `apps_${pageNum}_${limitNum}_${status || "all"}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`⚡ CACHE HIT! ${cacheKey} - ${Date.now() - startTime}ms`);
      return res.status(200).json(cachedData);
    }

    console.log(`📊 DB QUERY: ${cacheKey}`);

    if (mongoose.connection.readyState !== 1) {
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

    // ✅ SUPER FAST QUERY - WITH PLAN POPULATION!
    const applications = await Application.find(filter)
      .select(
        "applicationId firstName lastName email phoneNumber status createdAt idImage billingStarted registeredUserId billingCycleId idType idNumber tower floor unitNumber macAddress buildingId buildingName installationFee installationFeePaid serviceStatus planId",
      )
      .populate("planId", "name price speed") // ✅ POPULATE PLAN DATA!
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
      .maxTimeMS(3000);

    // ✅ GET TOTAL COUNT
    const totalCacheKey = `total_${status || "all"}`;
    let total = cache.get(totalCacheKey) as number | undefined;

    if (total === undefined) {
      console.log(`📊 Counting total for status: ${status || "all"}`);
      total = await Application.countDocuments(filter).maxTimeMS(3000);
      cache.set(totalCacheKey, total, 60);
      console.log(`✅ Total count: ${total} - CACHED`);
    } else {
      console.log(`⚡ TOTAL COUNT CACHE HIT! ${total}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `✅ ${applications.length} apps, Total: ${total} in ${elapsed}ms`,
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
      planId: app.planId, // ✅ NOW POPULATED!
      plan: app.planId, // ✅ PLAN DATA IS HERE!
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
      _cached: false,
    };

    cache.set(cacheKey, responseData, 30);

    console.log(`✅ Response in ${Date.now() - startTime}ms`);

    return res.status(200).json(responseData);
  } catch (error: any) {
    console.error("❌ Route error:", error);

    const cacheKey = `apps_${req.query.page || 1}_${req.query.limit || 20}_${req.query.status || "all"}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log("📦 Returning cached data due to error");
      return res.status(200).json(cachedData);
    }

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

// ============================================================
// ✅ GET ALL - NO LIMIT - WITH PLAN POPULATION! (FIXED!)
// ============================================================
router.get("/all", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const cacheKey = "apps_all";
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      console.log(`⚡ CACHE HIT! all - ${Date.now() - startTime}ms`);
      return res.status(200).json({
        success: true,
        data: (cachedData as any).data,
        total: (cachedData as any).total,
        cached: true,
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    console.log("📊 DB QUERY: all");

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database connection unavailable",
        data: [],
        total: 0,
      });
    }

    // ✅ FIXED: POPULATE PLAN DATA!
    const applications = await Application.find()
      .select(
        "applicationId firstName lastName email phoneNumber status createdAt idImage billingStarted registeredUserId billingCycleId idType idNumber tower floor unitNumber macAddress buildingId buildingName installationFee installationFeePaid serviceStatus planId",
      )
      .populate("planId", "name price speed") // ✅ POPULATE PLAN!
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(3000);

    const total = applications.length;

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
      planId: app.planId, // ✅ POPULATED PLAN DATA!
      plan: app.planId, // ✅ PLAN DATA!
      building: null,
    }));

    const responseData = { data: formattedData, total: total };
    cache.set(cacheKey, responseData, 60);

    console.log(
      `✅ ${total} apps with plan data in ${Date.now() - startTime}ms - CACHED`,
    );

    return res.status(200).json({
      success: true,
      data: formattedData,
      total: total,
      _responseTime: `${Date.now() - startTime}ms`,
      _cached: false,
    });
  } catch (error: any) {
    console.error("❌ Error:", error.message);

    const cachedData = cache.get("apps_all");
    if (cachedData) {
      return res.status(200).json({
        success: true,
        data: (cachedData as any).data,
        total: (cachedData as any).total,
        cached: true,
        error: "Using cached data",
        _responseTime: `${Date.now() - startTime}ms`,
      });
    }

    return res.status(200).json({
      success: true,
      data: [],
      total: 0,
      _responseTime: `${Date.now() - startTime}ms`,
      error: "Database timeout",
    });
  }
});

// ============================================================
// ✅ GET CACHE STATUS
// ============================================================
router.get("/cache/status", (req: Request, res: Response) => {
  const stats = cache.getStats();
  const keys = cache.keys();
  res.status(200).json({
    success: true,
    data: {
      keys: keys,
      count: keys.length,
      stats: stats,
    },
  });
});

// ============================================================
// ✅ CLEAR CACHE
// ============================================================
router.post("/cache/clear", (req: Request, res: Response) => {
  cache.flushAll();
  clearApplicationCache();
  console.log("🗑️ ALL CACHE CLEARED!");
  res.status(200).json({ success: true, message: "All cache cleared" });
});

// ============================================================
// ✅ DELETE - CLEAR CACHE
// ============================================================
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
    cache.flushAll();
    clearApplicationCache();

    res.status(200).json({
      success: true,
      message: `Application ${application.applicationId} deleted`,
      data: {
        applicationId: application.applicationId,
        firstName: application.firstName,
        lastName: application.lastName,
      },
    });
  } catch (error) {
    console.error("Error deleting:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting application",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============================================================
// ✅ BULK DELETE - CLEAR CACHE
// ============================================================
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
    cache.flushAll();
    clearApplicationCache();

    res.status(200).json({
      success: true,
      message: `${deleted.deletedCount} applications deleted`,
      data: { deletedCount: deleted.deletedCount },
    });
  } catch (error) {
    console.error("Error bulk deleting:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting applications",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============================================================
// ✅ SINGLE APPLICATION - WITH PLAN POPULATION!
// ============================================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const application = await Application.findById(req.params.id)
      .populate("planId", "name price speed duration features")
      .populate("buildingId", "buildingName streetAddress city barangay")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      data: application,
    });
  } catch (error) {
    console.error("Error fetching application:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching application",
    });
  }
});

// ============================================================
// ✅ APPROVE / REJECT
// ============================================================
router.put("/:id/approve", approveApplication);
router.put("/:id/reject", rejectApplication);

// ============================================================
// ✅ START BILLING
// ============================================================
router.post("/:applicationId/start-billing", startBillingForApplication);

// ============================================================
// ✅ UPDATE MAC ADDRESS - CLEAR CACHE
// ============================================================
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

    cache.flushAll();
    clearApplicationCache();

    res.status(200).json({
      success: true,
      data: {
        macAddress: application.macAddress,
        applicationId: application.applicationId,
      },
    });
  } catch (error) {
    console.error("Error updating MAC:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating MAC address",
    });
  }
});

// ============================================================
// ✅ UPDATE TOWER - CLEAR CACHE
// ============================================================
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

    cache.flushAll();
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

// ============================================================
// ✅ UPDATE STATUS - CLEAR CACHE
// ============================================================
router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (
      !status ||
      !["pending", "approved", "rejected", "suspended"].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status. Must be: pending, approved, rejected, suspended",
      });
    }

    const application = await Application.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    cache.flushAll();
    clearApplicationCache();

    res.status(200).json({
      success: true,
      data: {
        status: application.status,
        applicationId: application.applicationId,
      },
    });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating status",
    });
  }
});

// ============================================================
// ✅ TEST ROUTES
// ============================================================
router.get("/test/direct", async (req: Request, res: Response) => {
  try {
    const total = await Application.countDocuments();
    const apps = await Application.find()
      .limit(5)
      .select("applicationId firstName lastName email status createdAt")
      .lean();

    res.status(200).json({
      success: true,
      total,
      sample: apps,
      message: "Direct query successful",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

router.get("/test/simple", async (req: Request, res: Response) => {
  try {
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

    res.status(200).json({
      success: true,
      data: apps,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

console.log("✅ ULTIMATE SPEED ROUTES REGISTERED!");

export default router;
