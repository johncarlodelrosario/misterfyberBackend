// routes/buildingRoutes.ts - COMPLETE (ADD super_admin)
import express from "express";
import { body } from "express-validator";
import {
  createBuilding,
  getAllBuildings,
  getBuilding,
  updateBuilding,
  deleteBuilding,
  getActiveBuildings,
} from "../controllers/buildingController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// Public route for active buildings
router.get("/active", getActiveBuildings);

// Admin routes
// FIXED: Include super_admin in allowed roles
router.post(
  "/",
  protect,
  authorize("super_admin", "admin", "staff"),
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

router.get(
  "/",
  protect,
  authorize("super_admin", "admin", "staff"),
  getAllBuildings,
);
router.get(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  getBuilding,
);
router.put(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  updateBuilding,
);
router.delete(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  deleteBuilding,
);

export default router;
