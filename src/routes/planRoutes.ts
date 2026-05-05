// routes/planRoutes.ts - COMPLETE (ADD super_admin)
import express from "express";
import { body } from "express-validator";
import {
  getPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  getPlanFeatures,
  comparePlans,
} from "../controllers/planController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// Public routes
router.get("/", getPlans);
router.get("/features", getPlanFeatures);
router.get("/compare", comparePlans);
router.get("/:id", getPlan);

// Admin routes
// FIXED: Include super_admin in allowed roles
router.post(
  "/",
  protect,
  authorize("super_admin", "admin", "staff"),
  [
    body("name").notEmpty().withMessage("Plan name is required"),
    body("description").notEmpty().withMessage("Description is required"),
    body("price").isNumeric().withMessage("Price must be a number"),
    body("speed.download")
      .isNumeric()
      .withMessage("Download speed is required"),
    body("speed.upload").isNumeric().withMessage("Upload speed is required"),
    body("mikrotikProfile")
      .notEmpty()
      .withMessage("MikroTik profile is required"),
    body("duration").isNumeric().withMessage("Duration is required"),
  ],
  createPlan,
);

router.put(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  updatePlan,
);
router.delete(
  "/:id",
  protect,
  authorize("super_admin", "admin", "staff"),
  deletePlan,
);

export default router;
