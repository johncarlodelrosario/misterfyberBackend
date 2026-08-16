// backend/src/controllers/buildingController.ts - WITH CACHE!

import { Request, Response, NextFunction } from "express";
import Building from "../models/Building";
import { validationResult } from "express-validator";

type AuthRequest = Request & { user?: any };

// ============================================================
// 🔥 CACHE FOR ACTIVE BUILDINGS - SOBRANG BILIS!
// ============================================================
let activeBuildingsCache: any[] = [];
let activeBuildingsCacheTimestamp = 0;
const ACTIVE_BUILDINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let allBuildingsCache: {
  data: any[];
  total: number;
  timestamp: number;
  queryKey: string;
} | null = null;
const ALL_BUILDINGS_CACHE_TTL = 30 * 1000; // 30 seconds

function checkAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user || !req.user.role) {
    res.status(401).json({
      success: false,
      message: "You must be logged in as admin to perform this action",
    });
    return false;
  }
  const role = req.user.role;
  if (role !== "super_admin" && role !== "admin" && role !== "staff") {
    res.status(403).json({
      success: false,
      message: "Admin access required for this action",
    });
    return false;
  }
  return true;
}

export const createBuilding = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      buildingName,
      region,
      province,
      city,
      barangay,
      streetAddress,
      zipCode,
      location,
      installationFee,
    } = req.body;

    const existingBuilding = await Building.findOne({ buildingName });
    if (existingBuilding) {
      return res.status(400).json({
        success: false,
        message: "Building name already exists",
      });
    }

    const building = await Building.create({
      buildingName,
      region,
      province,
      city,
      barangay,
      streetAddress,
      zipCode: zipCode || "",
      location: location || "",
      installationFee: installationFee || 1500,
      isActive: true,
    });

    // Clear caches
    activeBuildingsCache = [];
    activeBuildingsCacheTimestamp = 0;
    allBuildingsCache = null;

    res.status(201).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllBuildings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { page = 1, limit = 10, isActive } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    let query: any = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const cacheKey = JSON.stringify({ query, pageNum, limitNum });
    const now = Date.now();

    // Check cache
    if (
      allBuildingsCache &&
      allBuildingsCache.queryKey === cacheKey &&
      now - allBuildingsCache.timestamp < ALL_BUILDINGS_CACHE_TTL
    ) {
      console.log("📦 Returning cached buildings");
      return res.status(200).json({
        success: true,
        data: allBuildingsCache.data,
        totalPages: Math.ceil((allBuildingsCache.total || 0) / limitNum),
        currentPage: pageNum,
        total: allBuildingsCache.total || 0,
        _cached: true,
      });
    }

    const buildings = await Building.find(query)
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum)
      .lean()
      .maxTimeMS(5000);

    const total = await Building.countDocuments(query);

    // Save to cache
    allBuildingsCache = {
      data: buildings,
      total: total,
      timestamp: now,
      queryKey: cacheKey,
    };

    res.status(200).json({
      success: true,
      data: buildings,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      total,
      _cached: false,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// 🔥 GET ACTIVE BUILDINGS - WITH CACHE!
// ============================================================
export const getActiveBuildings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();

    // Check cache
    if (
      activeBuildingsCache.length > 0 &&
      now - activeBuildingsCacheTimestamp < ACTIVE_BUILDINGS_CACHE_TTL
    ) {
      console.log("📦 Returning cached active buildings");
      return res.status(200).json({
        success: true,
        data: activeBuildingsCache,
        _cached: true,
      });
    }

    console.log("🔄 Fetching active buildings from database...");
    const buildings = await Building.find({ isActive: true })
      .select(
        "buildingName region province city barangay streetAddress zipCode location installationFee",
      )
      .sort({ buildingName: 1 })
      .lean()
      .maxTimeMS(5000);

    // Save to cache
    activeBuildingsCache = buildings;
    activeBuildingsCacheTimestamp = now;

    console.log(`✅ Cached ${buildings.length} active buildings`);

    res.status(200).json({
      success: true,
      data: buildings,
      _cached: false,
    });
  } catch (error) {
    next(error);
  }
};

export const getBuilding = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const building = await Building.findById(req.params.id).lean();

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    res.status(200).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

export const updateBuilding = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const building = await Building.findById(req.params.id);

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    const {
      buildingName,
      region,
      province,
      city,
      barangay,
      streetAddress,
      zipCode,
      location,
      installationFee,
      isActive,
    } = req.body;

    if (buildingName && buildingName !== building.buildingName) {
      const existing = await Building.findOne({ buildingName });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Building name already exists",
        });
      }
      building.buildingName = buildingName;
    }

    if (region !== undefined) building.region = region;
    if (province !== undefined) building.province = province;
    if (city !== undefined) building.city = city;
    if (barangay !== undefined) building.barangay = barangay;
    if (streetAddress !== undefined) building.streetAddress = streetAddress;
    if (zipCode !== undefined) building.zipCode = zipCode;
    if (location !== undefined) building.location = location;
    if (installationFee !== undefined && installationFee >= 0) {
      building.installationFee = installationFee;
    }
    if (isActive !== undefined) building.isActive = isActive;

    await building.save();

    // Clear caches
    activeBuildingsCache = [];
    activeBuildingsCacheTimestamp = 0;
    allBuildingsCache = null;

    res.status(200).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteBuilding = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const building = await Building.findById(req.params.id);

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    await building.deleteOne();

    // Clear caches
    activeBuildingsCache = [];
    activeBuildingsCacheTimestamp = 0;
    allBuildingsCache = null;

    res.status(200).json({
      success: true,
      message: "Building deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getBuildingInstallationFee = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { buildingId } = req.params;

    const building = await Building.findById(buildingId)
      .select("_id buildingName installationFee location")
      .lean()
      .maxTimeMS(3000);

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        buildingId: building._id,
        buildingName: building.buildingName,
        installationFee: building.installationFee,
        location: building.location,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateBuildingInstallationFee = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!checkAdmin(req, res)) return;

  try {
    const { buildingId } = req.params;
    const { installationFee } = req.body;

    if (installationFee === undefined || installationFee < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid installation fee is required (must be >= 0)",
      });
    }

    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    building.installationFee = installationFee;
    await building.save();

    // Clear caches
    activeBuildingsCache = [];
    activeBuildingsCacheTimestamp = 0;
    allBuildingsCache = null;

    res.status(200).json({
      success: true,
      message: `Installation fee for ${building.buildingName} updated to ₱${installationFee}`,
      data: {
        buildingId: building._id,
        buildingName: building.buildingName,
        installationFee: building.installationFee,
      },
    });
  } catch (error) {
    next(error);
  }
};

export default {
  createBuilding,
  getAllBuildings,
  getActiveBuildings,
  getBuilding,
  updateBuilding,
  deleteBuilding,
  getBuildingInstallationFee,
  updateBuildingInstallationFee,
};
