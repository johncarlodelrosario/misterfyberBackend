// routes/applicationRoutes.ts - COMPLETE FIXED
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
} from "../controllers/applicationController";
import { protect, authorize } from "../middleware/auth";
import { uploadIdCard } from "../middleware/upload";
import Application from "../models/Application";
import mongoose from "mongoose";

const router: Router = Router();

console.log("🔄 Registering application routes...");

// Public routes
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

// Protected routes
router.use(protect);
router.use(authorize("super_admin", "admin", "staff"));

// ============================================================
// GET all applications - FIXED with direct error handling
// ============================================================
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

router.get("/:id", getApplication);
router.put("/:id/approve", approveApplication);
router.put("/:id/reject", rejectApplication);
router.post("/:applicationId/start-billing", startBillingForApplication);

// Inline edit routes
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

console.log("✅ Application routes registered");

export default router;
