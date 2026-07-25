// backend/src/app.ts - COMPLETE FIXED VERSION
import express, { Application, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import fs from "fs";

import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import planRoutes from "./routes/planRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import mikrotikRoutes from "./routes/mikrotikRoutes";
import billingRoutes from "./routes/billingRoutes";
import adminRoutes from "./routes/adminRoutes";
import applicationRoutes from "./routes/applicationRoutes";
import buildingRoutes from "./routes/buildingRoutes";
import manualEmailRoutes from "./routes/manualEmailRoutes";
import invoiceRoutes from "./routes/invoiceRoutes";

import {
  autoGenerateMonthlyBills,
  autoSuspendOverdue,
} from "./controllers/billingController";
import { ensureIndexes } from "./models/Index";
import BillingSettings from "./models/BillingSettings";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

console.log("🔍 Environment Variables Load Check:");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "✅ SET" : "❌ NOT SET");
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("PORT:", process.env.PORT || 5000);
console.log(
  "FRONTEND_URL:",
  process.env.FRONTEND_URL || "http://localhost:3000",
);

// Allowed origins - includes all possible frontend URLs
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5000",
  "https://www.misterfyber.com",
  "https://misterfyber.com",
  "https://misterfyber.vercel.app",
  "https://misterfyber-frontend.vercel.app",
  "https://misterfyberbackend-lvjd.onrender.com",
  "https://newport-application.vercel.app",
  "https://vitalez-residence-application-form.vercel.app",
  process.env.FRONTEND_URL || "",
].filter(Boolean);

const app: Application = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  },
});

// ==================== MIDDLEWARES ====================
app.use(compression());

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

// Enhanced CORS configuration - FIXED
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Check if origin is in allowed list
      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      }

      // Allow localhost in any environment for testing
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return callback(null, true);
      }

      // Allow Render domain
      if (origin.includes("render.com")) {
        return callback(null, true);
      }

      // Allow Vercel domains
      if (origin.includes("vercel.app")) {
        return callback(null, true);
      }

      console.log("🔴 CORS blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Cookie",
      "Origin",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }),
);

// Handle preflight requests - FIXED
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cookie, X-Requested-With",
  );
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Max-Age", "86400");
  res.sendStatus(204);
});

app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Static files
const uploadsPath = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use(
  "/uploads",
  express.static(uploadsPath, {
    maxAge: "1d",
    etag: true,
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  }),
);
console.log(`📁 Serving static files from: ${uploadsPath}`);

// Ensure upload directories
const ensureUploadDirectories = () => {
  const dirs = [
    "uploads/id-cards",
    "uploads/payments",
    "uploads/temp",
    "uploads/profiles",
    "uploads/invoices",
  ];
  dirs.forEach((dir) => {
    const fullPath = path.join(__dirname, "../", dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`📁 Created directory: ${fullPath}`);
    }
  });
  console.log("✅ Upload directories ensured");
};
ensureUploadDirectories();

// ==================== ROUTES ====================
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "MisterFyber API",
    version: "1.0.0",
    status: "running",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req: Request, res: Response) => {
  const dbStatus = mongoose.connection.readyState;
  const statusMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    mongodb: statusMap[dbStatus as keyof typeof statusMap] || "unknown",
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// ==================== API ROUTES ====================
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/mikrotik", mikrotikRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/buildings", buildingRoutes);
app.use("/api/manual-email", manualEmailRoutes);
app.use("/api/invoices", invoiceRoutes);

// ==================== ERROR HANDLING ====================
// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.url}`,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("❌ Error:", err.stack);
  const status = (err as any).status || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({
    success: false,
    message,
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

// ==================== SOCKET.IO ====================
io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected:", socket.id);
  });
});

// ==================== DATABASE CONNECTION ====================
const initializeDatabase = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in environment variables");
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 5000,
    });

    console.log("✅ MongoDB connected successfully");
    await ensureIndexes();

    // Initialize default billing settings if not exists
    const settings = await BillingSettings.findOne();
    if (!settings) {
      await BillingSettings.create({
        reminderDays: [7, 3, 1],
        dueDateDaysAfterPeriod: 5,
        gracePeriodDays: 5,
        autoGenerateBills: true,
        autoSendReminders: true,
        autoSuspendOnNonPayment: true,
        billingCycleDay: 1,
        freeDays: 0,
        proRatedDueDay: 25,
        monthlyDueDay: 5,
        billingCutoffDay: 24,
        enableAutoBilling: true,
        sendInvoiceOnInstall: true,
        requireAdminActivation: false,
        installationFee: 1500,
        installationFeeDueDays: 7,
      });
      console.log("✅ Default billing settings initialized");
    }
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// ==================== SCHEDULED JOBS ====================
const initializeScheduledJobs = () => {
  console.log("🔄 Initializing scheduled billing jobs...");

  // Run at 1 AM daily - generate bills
  cron.schedule("0 1 * * *", async () => {
    try {
      console.log("🔄 Running auto-generate monthly bills job...");
      await autoGenerateMonthlyBills();
      console.log("✅ Auto-generate monthly bills completed");
    } catch (error) {
      console.error("❌ Auto-generate monthly bills failed:", error);
    }
  });

  // Run at 2 AM daily - suspend overdue
  cron.schedule("0 2 * * *", async () => {
    try {
      console.log("🔄 Running auto-suspend overdue job...");
      await autoSuspendOverdue();
      console.log("✅ Auto-suspend overdue completed");
    } catch (error) {
      console.error("❌ Auto-suspend overdue failed:", error);
    }
  });

  console.log("✅ Scheduled billing jobs initialized");
};

// ==================== START SERVER ====================
const start = async () => {
  await initializeDatabase();
  initializeScheduledJobs();

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🌐 Base URL: http://localhost:${PORT}`);
    console.log(
      `✅ CORS enabled for: ${allowedOrigins.filter((o) => o).join(", ")}`,
    );
    console.log(`📡 API available at: http://localhost:${PORT}/api`);
    console.log(`🩺 Health check: http://localhost:${PORT}/health`);
    console.log(`📧 Manual email routes available at: /api/manual-email`);
    console.log(`📄 Invoice routes available at: /api/invoices`);
    console.log(`📁 Uploads directory: ${uploadsPath}`);
    console.log(`\n✅ All systems ready!\n`);
  });
};

start();

export { app, server, io };
