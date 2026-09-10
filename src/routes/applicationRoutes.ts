// routes/applicationRoutes.ts - COMPLETE FINAL FIXED - WITH ID IMAGE
import express, { Router, Request, Response, NextFunction } from "express";
import { body } from "express-validator";
import {
  submitApplication,
  checkApplicationStatus,
  getApplication,
  approveApplication,
  rejectApplication,
  deleteApplication,
  bulkDeleteApplications,
  updateApplication,
  patchApplication,
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
import NodeCache from "node-cache";

const router: Router = Router();
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

console.log("🔥 ULTIMATE SPEED MODE - Application Routes");

// ============================================================
// ✅ FIXED: getImageUrl - returns the full URL for any image path
// ============================================================
function getImageUrl(imagePath?: string): string {
  if (!imagePath) return "";

  // If it's already a full URL
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("data:")
  ) {
    return imagePath;
  }

  const PRODUCTION_URL = "https://misterfyberbackend-q4k5.onrender.com";

  // Extract filename from path
  let filename = "";
  const parts = imagePath.split(/[\\\/]/);
  filename = parts[parts.length - 1];

  // If no filename or placeholder, use placeholder
  if (!filename || filename === "placeholder.jpg") {
    return `${PRODUCTION_URL}/uploads/id-cards/placeholder.jpg`;
  }

  // Build the full URL
  return `${PRODUCTION_URL}/uploads/id-cards/${filename}`;
}

const getStringQuery = (param: any): string => {
  if (!param) return "";
  if (typeof param === "string") return param;
  if (Array.isArray(param)) return param[0] || "";
  return String(param);
};

// ============================================================
// ✅ PUBLIC ROUTES
// ============================================================

// Address Data Routes
router.get("/address/regions", getRegions);
router.get("/address/provinces/:regionCode", getProvincesByRegion);
router.get("/address/cities/:provinceCode", getCitiesByProvince);
router.get("/address/barangays/:cityCode", getBarangaysByCity);

// ✅ SUBMIT APPLICATION - WITH PROPER VALIDATION
router.post(
  "/",
  uploadIdCard.single("idImage"),
  [
    body("firstName")
      .notEmpty()
      .withMessage("First name is required")
      .isString()
      .withMessage("First name must be a string")
      .isLength({ min: 1, max: 50 })
      .withMessage("First name must be between 1 and 50 characters"),
    body("lastName")
      .notEmpty()
      .withMessage("Last name is required")
      .isString()
      .withMessage("Last name must be a string")
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name must be between 1 and 50 characters"),
    body("email")
      .isEmail()
      .withMessage("Please provide a valid email")
      .normalizeEmail(),
    body("phoneNumber")
      .notEmpty()
      .withMessage("Phone number is required")
      .isString()
      .withMessage("Phone number must be a string"),
    body("buildingId")
      .notEmpty()
      .withMessage("Please select a building")
      .isMongoId()
      .withMessage("Invalid building ID"),
    body("tower")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("Tower must be a string"),
    body("floor")
      .notEmpty()
      .withMessage("Floor is required")
      .isString()
      .withMessage("Floor must be a string"),
    body("unitNumber")
      .notEmpty()
      .withMessage("Unit number is required")
      .isString()
      .withMessage("Unit number must be a string"),
    body("planId")
      .notEmpty()
      .withMessage("Plan is required")
      .isMongoId()
      .withMessage("Invalid plan ID"),
    body("idType")
      .notEmpty()
      .withMessage("ID type is required")
      .isString()
      .withMessage("ID type must be a string"),
    body("idNumber")
      .notEmpty()
      .withMessage("ID number is required")
      .isString()
      .withMessage("ID number must be a string"),
    body("macAddress")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("MAC address must be a string"),
  ],
  submitApplication,
);

// Check Application Status (Public)
router.get("/status/:applicationId", checkApplicationStatus);

// ============================================================
// ✅ PROTECTED ROUTES - Authentication Required
// ============================================================
router.use(protect);
router.use(authorize("super_admin", "admin", "staff"));

// ============================================================
// ✅ DASHBOARD ENDPOINTS
// ============================================================
router.get("/dashboard/data", getApplicationDashboardData);
router.get("/dashboard/stats", getApplicationStats);

// ============================================================
// ✅ MAIN GET - ULTRA FAST + WITH ID IMAGE
// ============================================================
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const page = getStringQuery(req.query.page) || "1";
    const limit = getStringQuery(req.query.limit) || "20";
    const status = getStringQuery(req.query.status);
    const search = getStringQuery(req.query.search);
    const buildingId = getStringQuery(req.query.buildingId);
    const forceRefresh = getStringQuery(req.query.forceRefresh);

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const cacheKey = `apps_ultra_${pageNum}_${limitNum}_${status || "all"}_${search || ""}_${buildingId || ""}`;

    if (forceRefresh !== "true") {
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        console.log(`⚡ CACHE HIT! ${cacheKey} - ${Date.now() - startTime}ms`);
        return res.status(200).json(cachedData);
      }
    }

    console.log(`📊 DB QUERY (ULTRA FAST): ${cacheKey}`);

    // ✅ BUILD FILTER
    const filter: any = {};

    if (status && status !== "all" && status !== "") {
      filter.status = status;
    }

    if (buildingId && buildingId !== "" && buildingId !== "all") {
      filter.buildingId = buildingId;
    }

    if (search && search.trim() !== "") {
      const searchTerm = search.trim();
      filter.$or = [
        { firstName: { $regex: searchTerm, $options: "i" } },
        { lastName: { $regex: searchTerm, $options: "i" } },
        { email: { $regex: searchTerm, $options: "i" } },
        { applicationId: { $regex: searchTerm, $options: "i" } },
        { phoneNumber: { $regex: searchTerm, $options: "i" } },
        { idNumber: { $regex: searchTerm, $options: "i" } },
      ];
    }

    console.log(`🔍 Final filter:`, JSON.stringify(filter, null, 2));

    // ✅ ULTRA FAST TOTAL
    let total = 0;
    const totalCacheKey = `total_ultra_${status || "all"}_${search || ""}_${buildingId || ""}`;
    const cachedTotal = cache.get(totalCacheKey) as number | undefined;

    if (cachedTotal !== undefined && forceRefresh !== "true") {
      total = cachedTotal;
      console.log(`⚡ TOTAL COUNT CACHE HIT! ${total}`);
    } else {
      console.log(`📊 Getting total count...`);
      if (Object.keys(filter).length === 0) {
        total = await Application.estimatedDocumentCount();
        console.log(`✅ Estimated total: ${total} (from collection stats)`);
      } else {
        total = await Application.countDocuments(filter);
        console.log(`✅ Counted total with filter: ${total}`);
      }
      cache.set(totalCacheKey, total, 60);
    }

    // ✅ GET DATA - INCLUDING idImage!
    const applications = await Application.find(filter)
      .select(
        "_id applicationId firstName lastName middleName email phoneNumber status createdAt buildingId buildingName tower floor unitNumber planId installationFee installationFeePaid serviceStatus billingStarted registeredUserId idType idNumber macAddress notes adminNotes idImage",
      )
      .populate("planId", "name price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const elapsed = Date.now() - startTime;

    // ✅ FORMATTED DATA - WITH idImageUrl!
    const formattedData = applications.map((app: any) => {
      // Get the ID image URL
      const idImageValue = app.idImage || "";
      const idImageUrl = getImageUrl(idImageValue);

      console.log(
        `📸 App ${app.applicationId}: idImage="${idImageValue}", url="${idImageUrl}"`,
      );

      return {
        _id: app._id,
        id: app._id,
        applicationId: app.applicationId,
        firstName: app.firstName,
        lastName: app.lastName,
        middleName: app.middleName || "",
        email: app.email,
        phoneNumber: app.phoneNumber,
        status: app.status,
        buildingId: app.buildingId,
        buildingName: app.buildingName,
        tower: app.tower || "",
        floor: app.floor || "",
        unitNumber: app.unitNumber || "",
        planId: app.planId,
        plan: app.planId?.name || "N/A",
        price: app.planId?.price || 0,
        installationFee: app.installationFee || 0,
        installationFeePaid: app.installationFeePaid || false,
        serviceStatus: app.serviceStatus || "pending",
        billingStarted: app.billingStarted || false,
        hasAccount: !!app.registeredUserId,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        idType: app.idType || "N/A",
        idNumber: app.idNumber || "N/A",
        macAddress: app.macAddress || "",
        notes: app.notes || "",
        adminNotes: app.adminNotes || "",
        // ✅ CRITICAL: Include both idImage and idImageUrl
        idImage: idImageValue,
        idImageUrl: idImageUrl,
      };
    });

    console.log(
      `✅ ${applications.length} apps, Total: ${total} in ${elapsed}ms`,
    );
    console.log(
      `📸 First app image: ${formattedData[0]?.idImageUrl || "none"}`,
    );

    const responseData = {
      success: true,
      data: formattedData,
      totalPages: Math.ceil((total || 0) / limitNum) || 1,
      currentPage: pageNum,
      total: total || 0,
      limit: limitNum,
      _responseTime: `${elapsed}ms`,
      _cached: false,
      _filters: { status, search, buildingId },
    };

    cache.set(cacheKey, responseData, 30);

    console.log(`✅ Response in ${Date.now() - startTime}ms`);

    return res.status(200).json(responseData);
  } catch (error: any) {
    console.error("❌ Route error:", error);

    const page = getStringQuery(req.query.page) || "1";
    const limit = getStringQuery(req.query.limit) || "20";
    const status = getStringQuery(req.query.status);
    const search = getStringQuery(req.query.search);
    const buildingId = getStringQuery(req.query.buildingId);
    const cacheKey = `apps_ultra_${page}_${limit}_${status || "all"}_${search || ""}_${buildingId || ""}`;
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
// ✅ GET ALL - NO LIMIT (WITH ID IMAGE)
// ============================================================
router.get("/all", async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const cacheKey = "apps_all_minimal";
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

    console.log("📊 DB QUERY: all (MINIMAL FIELDS)");

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database connection unavailable",
        data: [],
        total: 0,
      });
    }

    const applications = await Application.find()
      .select(
        "_id applicationId firstName lastName email phoneNumber status createdAt buildingName tower floor unitNumber planId idImage",
      )
      .populate("planId", "name price")
      .sort({ createdAt: -1 })
      .lean();

    const total = applications.length;

    const formattedData = applications.map((app: any) => ({
      _id: app._id,
      id: app.applicationId,
      name: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
      email: app.email,
      phone: app.phoneNumber,
      status: app.status,
      building: app.buildingName,
      unit:
        app.tower && app.floor
          ? `${app.tower} - ${app.floor}${app.unitNumber ? `-${app.unitNumber}` : ""}`
          : app.floor && app.unitNumber
            ? `${app.floor}${app.unitNumber ? `-${app.unitNumber}` : ""}`
            : "N/A",
      plan: app.planId?.name || "N/A",
      price: app.planId?.price || 0,
      createdAt: app.createdAt,
      idImage: app.idImage || "",
      idImageUrl: getImageUrl(app.idImage),
    }));

    const responseData = { data: formattedData, total: total };
    cache.set(cacheKey, responseData, 60);

    const elapsed = Date.now() - startTime;
    console.log(`✅ ${total} apps (minimal) in ${elapsed}ms - CACHED`);

    return res.status(200).json({
      success: true,
      data: formattedData,
      total: total,
      _responseTime: `${elapsed}ms`,
      _cached: false,
    });
  } catch (error: any) {
    console.error("❌ Error:", error.message);

    const cachedData = cache.get("apps_all_minimal");
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
// ✅ CACHE ROUTES
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

router.post("/cache/clear", (req: Request, res: Response) => {
  cache.flushAll();
  clearApplicationCache();
  console.log("🗑️ ALL CACHE CLEARED!");
  res.status(200).json({ success: true, message: "All cache cleared" });
});

// ============================================================
// ✅ DELETE - SINGLE APPLICATION
// ============================================================
router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteApplication(req as any, res, next);
    } catch (error) {
      console.error("Error deleting application:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting application",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

// ============================================================
// ✅ BULK DELETE
// ============================================================
router.post(
  "/bulk-delete",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await bulkDeleteApplications(req as any, res, next);
    } catch (error) {
      console.error("Error bulk deleting:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting applications",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

// ============================================================
// ✅ UPDATE APPLICATION - PUT (FULL UPDATE)
// ============================================================
router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await updateApplication(req as any, res, next);
  } catch (error) {
    console.error("Error updating application:", error);
    res.status(500).json({
      success: false,
      message: "Error updating application",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ============================================================
// ✅ PATCH APPLICATION - PARTIAL UPDATE
// ============================================================
router.patch(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await patchApplication(req as any, res, next);
    } catch (error) {
      console.error("Error patching application:", error);
      res.status(500).json({
        success: false,
        message: "Error updating application",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

// ============================================================
// ✅ SINGLE APPLICATION - GET BY ID (WITH ID IMAGE)
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

    // Add idImageUrl
    const result = {
      ...application,
      idImageUrl: getImageUrl(application.idImage),
    };

    res.status(200).json({
      success: true,
      data: result,
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
// ✅ UPDATE MAC ADDRESS
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
// ✅ UPDATE TOWER
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
// ✅ UPDATE STATUS
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
      .select("applicationId firstName lastName email status createdAt idImage")
      .lean();

    // Show image URLs for debugging
    const appsWithImages = apps.map((app: any) => ({
      ...app,
      idImageUrl: getImageUrl(app.idImage),
    }));

    res.status(200).json({
      success: true,
      total,
      sample: appsWithImages,
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
          "applicationId firstName lastName email status createdAt buildingName idImage",
        )
        .lean(),
      Application.countDocuments(),
    ]);

    const appsWithImages = apps.map((app: any) => ({
      ...app,
      idImageUrl: getImageUrl(app.idImage),
    }));

    res.status(200).json({
      success: true,
      data: appsWithImages,
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
