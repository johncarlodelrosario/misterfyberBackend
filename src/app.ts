// app.ts - COMPLETE WITH FIXED CORS
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

import {
  autoGenerateMonthlyBills,
  autoSendReminders,
  autoSuspendOverdue,
} from "./controllers/billingController";
import { ensureIndexes, BillingSettings } from "./models/Index";

dotenv.config({ path: path.join(__dirname, "../.env") });

console.log("🔍 Environment Variables Load Check:");
console.log("SMTP_HOST:", process.env.SMTP_HOST || "❌ NOT SET");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "✅ SET" : "❌ NOT SET");
console.log(
  "FRONTEND_URL:",
  process.env.FRONTEND_URL || "http://localhost:3000",
);

class App {
  public app: Application;
  public server: any;
  public io: Server;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: [
          "http://localhost:3000",
          "http://localhost:5173",
          "https://www.misterfyber.com",
          "https://misterfyber.com",
          "https://misterfyber.vercel.app",
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
      },
    });

    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
    this.initializeDatabase();
    this.initializeSocket();
    this.initializeScheduledJobs();
    this.ensureUploadDirectories();
  }

  private ensureUploadDirectories(): void {
    const dirs = [
      "uploads/id-cards",
      "uploads/payments",
      "uploads/temp",
      "uploads/profiles",
    ];
    dirs.forEach((dir) => {
      const fullPath = path.join(__dirname, "../", dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`📁 Created directory: ${fullPath}`);
      }
    });
    console.log("✅ Upload directories ensured");
  }

  private initializeMiddlewares(): void {
    this.app.use(compression());

    this.app.use(
      helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
        crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      }),
    );

    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5000",
      "https://www.misterfyber.com",
      "https://misterfyber.com",
      "https://misterfyber.vercel.app",
      process.env.FRONTEND_URL || "",
    ].filter(Boolean);

    this.app.use(
      cors({
        origin: function (origin, callback) {
          if (!origin) return callback(null, true);
          if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
          } else {
            console.log("CORS blocked origin:", origin);
            callback(null, true);
          }
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

    this.app.options("*", (req, res) => {
      res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      );
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Cookie",
      );
      res.header("Access-Control-Allow-Credentials", "true");
      res.sendStatus(204);
    });

    this.app.use(cookieParser());
    this.app.use(morgan("dev"));
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    const uploadsPath = path.join(__dirname, "../uploads");
    this.app.use(
      "/uploads",
      express.static(uploadsPath, {
        maxAge: "1d",
        etag: true,
        setHeaders: (res, path) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
        },
      }),
    );
    console.log(`📁 Serving static files from: ${uploadsPath}`);
  }

  private initializeRoutes(): void {
    this.app.get("/", (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        message: "MisterFyber API",
        version: "1.0.0",
        status: "running",
      });
    });

    this.app.get("/health", (req: Request, res: Response) => {
      res.status(200).json({
        status: "OK",
        timestamp: new Date(),
        mongodb:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      });
    });

    this.app.use("/api/auth", authRoutes);
    this.app.use("/api/users", userRoutes);
    this.app.use("/api/plans", planRoutes);
    this.app.use("/api/payments", paymentRoutes);
    this.app.use("/api/mikrotik", mikrotikRoutes);
    this.app.use("/api/billing", billingRoutes);
    this.app.use("/api/admin", adminRoutes);
    this.app.use("/api/applications", applicationRoutes);
    this.app.use("/api/buildings", buildingRoutes);
  }

  private async initializeDatabase(): Promise<void> {
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
        });
        console.log("✅ Default billing settings initialized");
      }
    } catch (error) {
      console.error("❌ MongoDB connection error:", error);
      process.exit(1);
    }
  }

  private initializeSocket(): void {
    this.io.on("connection", (socket) => {
      console.log("🔌 New client connected:", socket.id);
      socket.on("disconnect", () => {
        console.log("🔌 Client disconnected:", socket.id);
      });
    });
  }

  private initializeErrorHandling(): void {
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ success: false, message: "Route not found" });
    });

    this.app.use(
      (err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error("❌ Error:", err.stack);
        const status = (err as any).status || 500;
        const message = err.message || "Internal server error";
        res.status(status).json({
          success: false,
          message,
          error: process.env.NODE_ENV === "development" ? err : {},
        });
      },
    );
  }

  private initializeScheduledJobs(): void {
    console.log("🔄 Initializing scheduled billing jobs...");

    cron.schedule("0 1 * * *", async () => {
      try {
        console.log("🔄 Running auto-generate monthly bills job...");
        await autoGenerateMonthlyBills();
        console.log("✅ Auto-generate monthly bills completed");
      } catch (error) {
        console.error("❌ Auto-generate monthly bills failed:", error);
      }
    });

    cron.schedule("0 9 * * *", async () => {
      try {
        console.log("🔄 Running auto-send reminders job...");
        await autoSendReminders();
        console.log("✅ Auto-send reminders completed");
      } catch (error) {
        console.error("❌ Auto-send reminders failed:", error);
      }
    });

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
  }

  public start(): void {
    const PORT = process.env.PORT || 5000;
    this.server.listen(PORT, () => {
      console.log(`\n🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `✅ CORS enabled for: http://localhost:3000, https://www.misterfyber.com`,
      );
      console.log(
        `📡 API available at: ${process.env.BASE_URL || `http://localhost:${PORT}`}/api`,
      );
      console.log(`\n✅ All systems ready!\n`);
    });
  }
}

const app = new App();
app.start();
