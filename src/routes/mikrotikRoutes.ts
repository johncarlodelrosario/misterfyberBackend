import express from "express";
import { body } from "express-validator";
import {
  getStatus,
  configure,
  getUsers,
  getActiveConnections,
  getUserTraffic,
  applyPlanToUser,
  disableUser,
  removeUser,
  getInterfaces,
  getQueues,
  testConnection,
} from "../controllers/mikrotikController";
import { protect, authorize } from "../middleware/auth";

const router = express.Router();

// All MikroTik routes require admin access
router.use(protect);
router.use(authorize("admin"));

router.get("/status", getStatus);
router.get("/users", getUsers);
router.get("/active", getActiveConnections);
router.get("/interfaces", getInterfaces);
router.get("/queues", getQueues);
router.get("/traffic/:userId", getUserTraffic);

router.post(
  "/configure",
  [
    body("host").isIP().withMessage("Valid IP address is required"),
    body("port").isNumeric().withMessage("Port must be a number"),
    body("username").notEmpty().withMessage("Username is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  configure,
);

router.post("/test", testConnection);
router.post("/apply-plan/:userId", applyPlanToUser);
router.post("/disable/:userId", disableUser);
router.delete("/user/:userId", removeUser);

export default router;
