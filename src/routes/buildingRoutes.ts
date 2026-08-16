// backend/src/routes/buildingRoutes.ts - COMPLETE WITH INSTALLATION FEE ROUTES

import express from "express";
import { body } from "express-validator";
import {
  createBuilding,
  getAllBuildings,
  getBuilding,
  updateBuilding,
  deleteBuilding,
  getActiveBuildings,
  getBuildingInstallationFee,
  updateBuildingInstallationFee,
} from "../controllers/buildingController";
import { protect, adminMiddleware } from "../middleware/auth";

const router = express.Router();

// Public route for active buildings - WITH CACHE!
router.get("/active", getActiveBuildings);

// Get building installation fee - semi-public (can be accessed with auth)
router.get("/:buildingId/installation-fee", getBuildingInstallationFee);

// Admin routes
router.post(
  "/",
  protect,
  adminMiddleware,
  [
    body("buildingName").notEmpty().withMessage("Building name is required"),
    body("region").notEmpty().withMessage("Region is required"),
    body("province").notEmpty().withMessage("Province is required"),
    body("city").notEmpty().withMessage("City is required"),
    body("barangay").notEmpty().withMessage("Barangay is required"),
    body("streetAddress").notEmpty().withMessage("Street address is required"),
  ],
  createBuilding,
);

router.get("/", protect, adminMiddleware, getAllBuildings);
router.get("/:id", protect, adminMiddleware, getBuilding);
router.put("/:id", protect, adminMiddleware, updateBuilding);
router.delete("/:id", protect, adminMiddleware, deleteBuilding);

// Installation fee management routes
router.put(
  "/:buildingId/installation-fee",
  protect,
  adminMiddleware,
  updateBuildingInstallationFee,
);

export default router;
