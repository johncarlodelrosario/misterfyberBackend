// backend/src/config/database.ts - WITH TEXT INDEX
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

interface DatabaseConfig {
  uri: string;
  options: mongoose.ConnectOptions;
}

class Database {
  private static instance: Database;
  private isConnected: boolean = false;
  private connectionRetries: number = 0;
  private maxRetries: number = 5;
  private retryDelay: number = 5000;

  private constructor() {}

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  private getConfig(): DatabaseConfig {
    const baseOptions: mongoose.ConnectOptions = {
      autoIndex: process.env.NODE_ENV === "development",
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 120000,
      connectTimeoutMS: 60000,
      family: 4,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 60000,
      heartbeatFrequencyMS: 30000,
      retryWrites: true,
      retryReads: true,
      waitQueueTimeoutMS: 30000,
    };

    if (process.env.MONGODB_USER && process.env.MONGODB_PASS) {
      baseOptions.auth = {
        username: process.env.MONGODB_USER,
        password: process.env.MONGODB_PASS,
      };
      baseOptions.authSource = process.env.MONGODB_AUTH_SOURCE || "admin";
    }

    return {
      uri:
        process.env.MONGODB_URI || "mongodb://localhost:27017/isp_management",
      options: baseOptions,
    };
  }

  private setupEventListeners(): void {
    mongoose.connection.on("connected", () => {
      console.log("✅ MongoDB connected successfully");
      this.isConnected = true;
      this.connectionRetries = 0;
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
      this.isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected");
      this.isConnected = false;
      this.handleDisconnection();
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
      this.isConnected = true;
    });

    mongoose.connection.on("reconnectFailed", () => {
      console.error("❌ MongoDB reconnection failed");
      this.handleReconnectFailure();
    });

    process.on("SIGINT", this.gracefulShutdown.bind(this));
    process.on("SIGTERM", this.gracefulShutdown.bind(this));
  }

  private async handleDisconnection(): Promise<void> {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      console.log(
        `🔄 Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`,
      );

      setTimeout(async () => {
        try {
          await this.connect();
        } catch (error) {
          console.error("❌ Reconnection attempt failed:", error);
        }
      }, this.retryDelay * this.connectionRetries);
    } else {
      console.error("❌ Max reconnection attempts reached. Exiting...");
      process.exit(1);
    }
  }

  private handleReconnectFailure(): void {
    console.error(
      "❌ Failed to reconnect to MongoDB. Please check your database server.",
    );
  }

  private async gracefulShutdown(): Promise<void> {
    try {
      await mongoose.connection.close();
      console.log("✅ MongoDB connection closed through app termination");
      process.exit(0);
    } catch (err) {
      console.error("❌ Error during graceful shutdown:", err);
      process.exit(1);
    }
  }

  public async connect(): Promise<void> {
    try {
      if (this.isConnected && mongoose.connection.readyState === 1) {
        console.log("✅ Using existing database connection");
        return;
      }

      const config = this.getConfig();

      console.log("🔗 Connecting to MongoDB...");
      console.log(
        `   URI: ${config.uri.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@")}`,
      );

      await mongoose.connect(config.uri, config.options);

      this.setupEventListeners();
      this.isConnected = true;

      await this.createIndexes();

      console.log("✅ Database connection established");
    } catch (error) {
      console.error("❌ Failed to connect to MongoDB:", error);
      this.isConnected = false;

      console.log("⚠️ Will retry connection in 10 seconds...");
      setTimeout(() => this.connect(), 10000);

      throw error;
    }
  }

  private async createIndexes(): Promise<void> {
    try {
      const db = mongoose.connection.db;
      if (!db) {
        throw new Error("Database connection not established");
      }

      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map((c) => c.name);

      // ============================================================
      // APPLICATION INDEXES - WITH TEXT INDEX
      // ============================================================
      if (collectionNames.includes("applications")) {
        const applicationsCollection = db.collection("applications");
        const appIndexes = await applicationsCollection.indexes();
        const appIndexNames = appIndexes.map((idx) => idx.name);

        // Single field indexes
        if (!appIndexNames.includes("applicationId_1")) {
          await applicationsCollection.createIndex(
            { applicationId: 1 },
            { unique: true },
          );
          console.log("✅ Created applicationId index");
        }

        if (!appIndexNames.includes("email_1")) {
          await applicationsCollection.createIndex({ email: 1 });
          console.log("✅ Created email index");
        }

        if (!appIndexNames.includes("buildingId_1")) {
          await applicationsCollection.createIndex({ buildingId: 1 });
          console.log("✅ Created buildingId index");
        }

        if (!appIndexNames.includes("status_1")) {
          await applicationsCollection.createIndex({ status: 1 });
          console.log("✅ Created status index");
        }

        if (!appIndexNames.includes("createdAt_-1")) {
          await applicationsCollection.createIndex({ createdAt: -1 });
          console.log("✅ Created createdAt index");
        }

        if (!appIndexNames.includes("phoneNumber_1")) {
          await applicationsCollection.createIndex({ phoneNumber: 1 });
          console.log("✅ Created phoneNumber index");
        }

        if (!appIndexNames.includes("planId_1")) {
          await applicationsCollection.createIndex({ planId: 1 });
          console.log("✅ Created planId index");
        }

        if (!appIndexNames.includes("billingStarted_1")) {
          await applicationsCollection.createIndex({ billingStarted: 1 });
          console.log("✅ Created billingStarted index");
        }

        if (!appIndexNames.includes("registeredUserId_1")) {
          await applicationsCollection.createIndex({ registeredUserId: 1 });
          console.log("✅ Created registeredUserId index");
        }

        // Compound indexes
        if (!appIndexNames.includes("status_1_createdAt_-1")) {
          await applicationsCollection.createIndex({
            status: 1,
            createdAt: -1,
          });
          console.log("✅ Created compound index status+createdAt");
        }

        if (
          !appIndexNames.includes("buildingId_1_floor_1_unitNumber_1_tower_1")
        ) {
          await applicationsCollection.createIndex({
            buildingId: 1,
            floor: 1,
            unitNumber: 1,
            tower: 1,
          });
          console.log("✅ Created compound index for duplicate check");
        }

        // ============================================================
        // 🔥 TEXT INDEX FOR FAST SEARCH - CRITICAL!
        // ============================================================
        const hasTextIndex = appIndexes.some((idx) => idx.key && idx.key._fts);

        if (!hasTextIndex) {
          try {
            await applicationsCollection.createIndex(
              {
                firstName: "text",
                lastName: "text",
                email: "text",
                phoneNumber: "text",
                applicationId: "text",
              },
              {
                weights: {
                  applicationId: 10,
                  firstName: 5,
                  lastName: 5,
                  email: 3,
                  phoneNumber: 2,
                },
                name: "search_text_index",
              },
            );
            console.log("✅ Created TEXT INDEX for search");
          } catch (textError) {
            console.error("❌ Failed to create text index:", textError);
          }
        } else {
          console.log("✅ Text index already exists");
        }

        console.log("✅ Application indexes created with text search");
      }

      // ============================================================
      // USER INDEXES
      // ============================================================
      if (collectionNames.includes("users")) {
        const usersCollection = db.collection("users");
        const userIndexes = await usersCollection.indexes();
        const userIndexNames = userIndexes.map((idx) => idx.name);

        if (!userIndexNames.includes("email_1")) {
          await usersCollection.createIndex({ email: 1 }, { unique: true });
          console.log("✅ Created email index on users");
        }
        if (!userIndexNames.includes("username_1")) {
          await usersCollection.createIndex({ username: 1 }, { unique: true });
          console.log("✅ Created username index on users");
        }
        if (!userIndexNames.includes("status_1")) {
          await usersCollection.createIndex({ status: 1 });
          console.log("✅ Created status index on users");
        }
        if (!userIndexNames.includes("role_1")) {
          await usersCollection.createIndex({ role: 1 });
          console.log("✅ Created role index on users");
        }
        if (!userIndexNames.includes("status_1_role_1")) {
          await usersCollection.createIndex({ status: 1, role: 1 });
          console.log("✅ Created compound index on users");
        }
      }

      // ============================================================
      // PLAN INDEXES
      // ============================================================
      if (collectionNames.includes("plans")) {
        const plansCollection = db.collection("plans");
        const planIndexes = await plansCollection.indexes();
        const planIndexNames = planIndexes.map((idx) => idx.name);

        if (!planIndexNames.includes("name_1")) {
          await plansCollection.createIndex({ name: 1 }, { unique: true });
          console.log("✅ Created name index on plans");
        }
        if (!planIndexNames.includes("isActive_1")) {
          await plansCollection.createIndex({ isActive: 1 });
          console.log("✅ Created isActive index on plans");
        }
        if (!planIndexNames.includes("price_1")) {
          await plansCollection.createIndex({ price: 1 });
          console.log("✅ Created price index on plans");
        }
      }

      // ============================================================
      // PAYMENT INDEXES
      // ============================================================
      if (collectionNames.includes("payments")) {
        const paymentsCollection = db.collection("payments");
        const paymentIndexes = await paymentsCollection.indexes();
        const paymentIndexNames = paymentIndexes.map((idx) => idx.name);

        if (!paymentIndexNames.includes("userId_1_createdAt_-1")) {
          await paymentsCollection.createIndex({ userId: 1, createdAt: -1 });
          console.log("✅ Created userId+createdAt index on payments");
        }
        if (!paymentIndexNames.includes("status_1")) {
          await paymentsCollection.createIndex({ status: 1 });
          console.log("✅ Created status index on payments");
        }
        if (!paymentIndexNames.includes("referenceNumber_1")) {
          await paymentsCollection.createIndex(
            { referenceNumber: 1 },
            { unique: true },
          );
          console.log("✅ Created referenceNumber index on payments");
        }
        if (!paymentIndexNames.includes("transactionId_1")) {
          await paymentsCollection.createIndex({ transactionId: 1 });
          console.log("✅ Created transactionId index on payments");
        }
        if (!paymentIndexNames.includes("applicationId_1")) {
          await paymentsCollection.createIndex({ applicationId: 1 });
          console.log("✅ Created applicationId index on payments");
        }
        if (!paymentIndexNames.includes("paymentType_1")) {
          await paymentsCollection.createIndex({ paymentType: 1 });
          console.log("✅ Created paymentType index on payments");
        }
        if (!paymentIndexNames.includes("customerName_1")) {
          await paymentsCollection.createIndex({ customerName: 1 });
          console.log("✅ Created customerName index on payments");
        }
      }

      // ============================================================
      // BILLING INDEXES
      // ============================================================
      if (collectionNames.includes("billings")) {
        const billingsCollection = db.collection("billings");
        const billingIndexes = await billingsCollection.indexes();
        const billingIndexNames = billingIndexes.map((idx) => idx.name);

        if (!billingIndexNames.includes("userId_1_dueDate_-1")) {
          await billingsCollection.createIndex({ userId: 1, dueDate: -1 });
          console.log("✅ Created userId+dueDate index on billings");
        }
        if (!billingIndexNames.includes("status_1")) {
          await billingsCollection.createIndex({ status: 1 });
          console.log("✅ Created status index on billings");
        }
        if (!billingIndexNames.includes("invoiceNumber_1")) {
          await billingsCollection.createIndex(
            { invoiceNumber: 1 },
            { unique: true },
          );
          console.log("✅ Created invoiceNumber index on billings");
        }
        if (!billingIndexNames.includes("dueDate_1")) {
          await billingsCollection.createIndex({ dueDate: 1 });
          console.log("✅ Created dueDate index on billings");
        }
        if (!billingIndexNames.includes("applicationId_1")) {
          await billingsCollection.createIndex({ applicationId: 1 });
          console.log("✅ Created applicationId index on billings");
        }
      }

      // ============================================================
      // BILLING CYCLE INDEXES
      // ============================================================
      if (collectionNames.includes("billingcycles")) {
        const billingCycleCollection = db.collection("billingcycles");
        const cycleIndexes = await billingCycleCollection.indexes();
        const cycleIndexNames = cycleIndexes.map((idx) => idx.name);

        if (!cycleIndexNames.includes("applicationId_1")) {
          await billingCycleCollection.createIndex({ applicationId: 1 });
          console.log("✅ Created applicationId index on billingcycles");
        }
        if (!cycleIndexNames.includes("status_1")) {
          await billingCycleCollection.createIndex({ status: 1 });
          console.log("✅ Created status index on billingcycles");
        }
        if (!cycleIndexNames.includes("nextBillingDate_1")) {
          await billingCycleCollection.createIndex({ nextBillingDate: 1 });
          console.log("✅ Created nextBillingDate index on billingcycles");
        }
      }

      // ============================================================
      // INVOICE INDEXES
      // ============================================================
      if (collectionNames.includes("invoices")) {
        const invoiceCollection = db.collection("invoices");
        const invoiceIndexes = await invoiceCollection.indexes();
        const invoiceIndexNames = invoiceIndexes.map((idx) => idx.name);

        if (!invoiceIndexNames.includes("invoiceNumber_1")) {
          await invoiceCollection.createIndex(
            { invoiceNumber: 1 },
            { unique: true },
          );
          console.log("✅ Created invoiceNumber index on invoices");
        }
        if (!invoiceIndexNames.includes("applicationId_1")) {
          await invoiceCollection.createIndex({ applicationId: 1 });
          console.log("✅ Created applicationId index on invoices");
        }
        if (!invoiceIndexNames.includes("status_1")) {
          await invoiceCollection.createIndex({ status: 1 });
          console.log("✅ Created status index on invoices");
        }
        if (!invoiceIndexNames.includes("billingId_1")) {
          await invoiceCollection.createIndex({ billingId: 1 });
          console.log("✅ Created billingId index on invoices");
        }
      }

      // ============================================================
      // MIKROTIK CONFIG INDEXES
      // ============================================================
      if (collectionNames.includes("mikrotikconfigs")) {
        const mikrotikCollection = db.collection("mikrotikconfigs");
        const mikrotikIndexes = await mikrotikCollection.indexes();
        const mikrotikIndexNames = mikrotikIndexes.map((idx) => idx.name);

        if (!mikrotikIndexNames.includes("isActive_1")) {
          await mikrotikCollection.createIndex({ isActive: 1 });
          console.log("✅ Created isActive index on mikrotikconfigs");
        }
        if (!mikrotikIndexNames.includes("host_1")) {
          await mikrotikCollection.createIndex({ host: 1 }, { unique: true });
          console.log("✅ Created host index on mikrotikconfigs");
        }
      }

      // ============================================================
      // NOTIFICATION INDEXES
      // ============================================================
      if (collectionNames.includes("notifications")) {
        const notificationsCollection = db.collection("notifications");
        const notificationIndexes = await notificationsCollection.indexes();
        const notificationIndexNames = notificationIndexes.map(
          (idx) => idx.name,
        );

        if (!notificationIndexNames.includes("userId_1_createdAt_-1")) {
          await notificationsCollection.createIndex({
            userId: 1,
            createdAt: -1,
          });
          console.log("✅ Created userId+createdAt index on notifications");
        }
        if (!notificationIndexNames.includes("isRead_1")) {
          await notificationsCollection.createIndex({ isRead: 1 });
          console.log("✅ Created isRead index on notifications");
        }
      }

      console.log("✅ All database indexes created successfully");
    } catch (error) {
      console.error("❌ Error creating indexes:", error);
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await mongoose.connection.close();
      this.isConnected = false;
      console.log("✅ Database disconnected");
    } catch (error) {
      console.error("❌ Error disconnecting from database:", error);
      throw error;
    }
  }

  public getConnectionStatus(): boolean {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  public async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    latency: number;
    connections: number;
  }> {
    const start = Date.now();

    try {
      await mongoose.connection.db.admin().ping();
      const latency = Date.now() - start;
      const connections = mongoose.connection.readyState === 1 ? 1 : 0;

      return {
        status: "healthy",
        latency,
        connections,
      };
    } catch (error) {
      console.error("❌ Database health check failed:", error);
      return {
        status: "unhealthy",
        latency: Date.now() - start,
        connections: 0,
      };
    }
  }
}

export default Database.getInstance();

export const connectDB = async (): Promise<void> => {
  const db = Database.getInstance();
  await db.connect();
};

export const disconnectDB = async (): Promise<void> => {
  const db = Database.getInstance();
  await db.disconnect();
};

export const checkDBHealth = async () => {
  const db = Database.getInstance();
  return await db.healthCheck();
};
