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
  startBillingForApplication,
} from "../controllers/applicationController";
import { protect, authorize } from "../middleware/auth";
import { uploadIdCard } from "../middleware/upload";
import Application from "../models/Application"; // ADD THIS IMPORT

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
router.use(authorize("super_admin", "admin", "staff"));

router.get("/", getAllApplications);
router.get("/:id", getApplication);
router.put("/:id/approve", approveApplication);
router.put("/:id/reject", rejectApplication);
router.post("/:applicationId/start-billing", startBillingForApplication);

// ==================== ADD THIS NEW ROUTE ====================
// Edit MAC Address for application (inline edit)
router.patch(
  "/:id/mac-address",
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      const { macAddress } = req.body;

      console.log(
        `📝 Updating MAC address for application ${id} to: ${macAddress}`,
      );

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

      console.log(`✅ MAC address updated for ${application.applicationId}`);

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
  },
);

export default router;
