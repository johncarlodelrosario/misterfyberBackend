// routes/applicationRoutes.ts - COMPLETE (ADD super_admin)
import express from "express";
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
} from "../controllers/applicationController";
import { protect, authorize } from "../middleware/auth";
import { uploadIdCard } from "../middleware/upload";

const router = express.Router();

// Public routes - no authentication needed
router.get("/address/regions", getRegions);
router.get("/address/provinces/:regionCode", getProvincesByRegion);
router.get("/address/cities/:provinceCode", getCitiesByProvince);
router.get("/address/barangays/:cityCode", getBarangaysByCity);

// Public - application submission
router.post(
  "/",
  uploadIdCard.single("idImage"),
  [
    body("firstName").notEmpty().withMessage("First name is required"),
    body("lastName").notEmpty().withMessage("Last name is required"),
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("phoneNumber").notEmpty().withMessage("Phone number is required"),
    body("buildingId").notEmpty().withMessage("Please select a building"),
    body("floor").notEmpty().withMessage("Floor is required"),
    body("unitNumber").notEmpty().withMessage("Unit number is required"),
    body("planId").notEmpty().withMessage("Plan is required"),
    body("idType").notEmpty().withMessage("ID type is required"),
    body("idNumber").notEmpty().withMessage("ID number is required"),
  ],
  submitApplication,
);

// Public - check application status
router.get("/status/:applicationId", checkApplicationStatus);

// Admin only routes - require authentication and admin role
router.use(protect);
// FIXED: Include super_admin in allowed roles
router.use(authorize("super_admin", "admin", "staff"));

router.get("/", getAllApplications);
router.get("/:id", getApplication);
router.put("/:id/approve", approveApplication);
router.put("/:id/reject", rejectApplication);

export default router;
