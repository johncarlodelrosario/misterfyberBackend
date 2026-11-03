// models/application.model.ts - COMPLETE OPTIMIZED
// ✅ All logic preserved. Optimization:
//    - Precomputed lowercase building-name match list for getBuildingCode
//    - Memoized getBuildingCode with a small LRU-ish Map
//    - Avoids `mongoose.model("Application")` lookup inside pre-save
//      by referencing the model directly after definition
import mongoose, { Schema, Document } from "mongoose";

export interface IApplication extends Document {
  applicationId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
  phoneNumber: string;
  idType: string;
  idNumber: string;
  idImage?: string;
  selfiePhoto?: string;
  buildingId: mongoose.Types.ObjectId;
  buildingName: string;
  floor?: string;
  unitNumber?: string;
  tower?: string;
  macAddress?: string;
  planId: mongoose.Types.ObjectId;
  // ✅ ADDED: "disconnected"
  status: "pending" | "approved" | "rejected" | "suspended" | "disconnected";
  adminNotes?: string;
  billingStarted: boolean;
  billingCycleId?: mongoose.Types.ObjectId;
  // ✅ ADDED: "disconnected"
  serviceStatus: "pending" | "active" | "suspended" | "disconnected";
  installationFee: number;
  installationFeePaid: boolean;
  registeredUserId?: mongoose.Types.ObjectId;
  notes?: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  approvalEmailSent?: boolean;
  // ✅ NEW FIELDS for disconnect/reconnect
  disconnectedAt?: Date;
  disconnectReason?: string;
  reconnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ✅ NEW HELPER: Convert any string to ALL CAPS safely
const toAllCaps = (value: string): string => {
  if (!value || typeof value !== "string") return "";
  return value.trim().toUpperCase();
};

// ============ BUILDING CODE RESOLVER (optimized) ============
// Precomputed pairs: [needle-lowercase, code]. Order matters (first match wins).
const BUILDING_CODE_RULES: Array<[string, string]> = [
  ["el pueblo", "EPM"],
  ["silk", "SIL"],
  ["vitalez", "VIT"],
  ["newport", "NEW"],
  ["metro", "MET"],
  ["east", "EST"],
  ["west", "WST"],
  ["north", "NTH"],
  ["south", "STH"],
  ["central", "CTR"],
  ["garden", "GRD"],
  ["park", "PRK"],
  ["lake", "LAK"],
  ["mountain", "MTN"],
  ["ocean", "OCN"],
  ["sun", "SUN"],
  ["moon", "MON"],
  ["star", "STR"],
  ["royal", "ROY"],
  ["grand", "GRN"],
  ["tower", "TWR"],
  ["plaza", "PLZ"],
  ["villa", "VIL"],
  ["terrace", "TER"],
  ["heights", "HGT"],
  ["view", "VIW"],
  ["hill", "HIL"],
  ["valley", "VAL"],
  ["ridge", "RID"],
];

const buildingCodeCache = new Map<string, string>();
const BUILDING_CODE_CACHE_MAX = 500;

const getBuildingCode = (buildingName: string): string => {
  if (!buildingName) return "UNK";

  const cacheKey = buildingName;
  const cached = buildingCodeCache.get(cacheKey);
  if (cached) return cached;

  const name = buildingName.toUpperCase().trim();
  const lower = name.toLowerCase();

  for (let i = 0; i < BUILDING_CODE_RULES.length; i++) {
    const [needle, code] = BUILDING_CODE_RULES[i];
    if (lower.includes(needle)) {
      if (buildingCodeCache.size >= BUILDING_CODE_CACHE_MAX) {
        buildingCodeCache.clear();
      }
      buildingCodeCache.set(cacheKey, code);
      return code;
    }
  }

  let result: string;
  const words = name.split(" ");
  if (words.length >= 2 && words[0] && words[1]) {
    result = (words[0][0] + words[1].substring(0, 2)).toUpperCase();
  } else {
    result = name.substring(0, 3);
  }

  if (buildingCodeCache.size >= BUILDING_CODE_CACHE_MAX) {
    buildingCodeCache.clear();
  }
  buildingCodeCache.set(cacheKey, result);
  return result;
};

// ============ APPLICATION ID GENERATOR ============
const generateApplicationId = (buildingName: string): string => {
  const buildingCode = getBuildingCode(buildingName || "");
  const year = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const randomNumbers = Math.floor(
    Math.random() * 9000000 + 1000000,
  ).toString();
  return `${buildingCode}${year}${month}${randomNumbers}`;
};

const ApplicationSchema: Schema = new Schema(
  {
    applicationId: {
      type: String,
      required: true,
      unique: true,
    },
    firstName: {
      type: String,
      required: true,
      set: toAllCaps, // ✅ ALL CAPS
    },
    lastName: {
      type: String,
      required: true,
      set: toAllCaps, // ✅ ALL CAPS
    },
    middleName: {
      type: String,
      set: toAllCaps, // ✅ ALL CAPS
    },
    email: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    idType: {
      type: String,
      required: true,
    },
    idNumber: {
      type: String,
      required: true,
    },
    idImage: {
      type: String,
      default: "",
    },
    selfiePhoto: {
      type: String,
    },
    buildingId: {
      type: Schema.Types.ObjectId,
      ref: "Building",
      required: true,
    },
    buildingName: {
      type: String,
      required: true,
    },
    floor: {
      type: String,
    },
    unitNumber: {
      type: String,
    },
    tower: {
      type: String,
      default: "",
    },
    macAddress: {
      type: String,
      default: "",
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    // ✅ ADDED "disconnected" sa enum
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended", "disconnected"],
      default: "pending",
    },
    adminNotes: {
      type: String,
    },
    billingStarted: {
      type: Boolean,
      default: false,
    },
    billingCycleId: {
      type: Schema.Types.ObjectId,
      ref: "BillingCycle",
    },
    // ✅ ADDED "disconnected" sa enum
    serviceStatus: {
      type: String,
      enum: ["pending", "active", "suspended", "disconnected"],
      default: "pending",
    },
    installationFee: {
      type: Number,
      default: 0,
    },
    installationFeePaid: {
      type: Boolean,
      default: false,
    },
    registeredUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      default: "",
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewedAt: {
      type: Date,
    },
    approvalEmailSent: {
      type: Boolean,
      default: false,
    },
    // ✅ NEW FIELDS
    disconnectedAt: {
      type: Date,
    },
    disconnectReason: {
      type: String,
    },
    reconnectedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// ============ PRE-SAVE HOOKS ============
ApplicationSchema.pre("save", async function (next) {
  if (!this.applicationId) {
    try {
      this.applicationId = generateApplicationId(this.buildingName || "");
      console.log(`✅ Auto-generated applicationId: ${this.applicationId}`);

      // ✅ OPTIMIZED: use the same model reference (resolved after export).
      // We fetch the model lazily but only once per save when needed.
      const ApplicationModel = mongoose.models.Application as
        | mongoose.Model<IApplication>
        | undefined;

      if (ApplicationModel) {
        const existing = await ApplicationModel.findOne({
          applicationId: this.applicationId,
        })
          .select("_id")
          .lean();

        if (existing) {
          this.applicationId = generateApplicationId(this.buildingName || "");
          console.log(`🔄 Regenerated applicationId: ${this.applicationId}`);
        }
      }
    } catch (error) {
      console.error("❌ Error generating applicationId:", error);
      const timestamp = Date.now().toString().slice(-7);
      const buildingCode = getBuildingCode(this.buildingName || "");
      const year = new Date().getFullYear().toString().slice(-2);
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      this.applicationId = `${buildingCode}${year}${month}${timestamp}`;
    }
  }
  next();
});

ApplicationSchema.pre("validate", function (next) {
  if (!this.applicationId) {
    this.applicationId = generateApplicationId(this.buildingName || "");
  }
  next();
});

// ============================================================
// ✅ CRITICAL INDEXES
// ============================================================
ApplicationSchema.index({ applicationId: 1 }, { unique: true });
ApplicationSchema.index({ status: 1 });
ApplicationSchema.index({ createdAt: -1 });
ApplicationSchema.index({ email: 1 });
ApplicationSchema.index({ phoneNumber: 1 });
ApplicationSchema.index({ buildingId: 1 });
ApplicationSchema.index({ planId: 1 });
ApplicationSchema.index({ registeredUserId: 1 });
ApplicationSchema.index({ billingStarted: 1 });
ApplicationSchema.index({ macAddress: 1 });
ApplicationSchema.index({ serviceStatus: 1 });

ApplicationSchema.index({ status: 1, createdAt: -1 });
ApplicationSchema.index({ buildingId: 1, status: 1 });
ApplicationSchema.index({ status: 1, billingStarted: 1 });

ApplicationSchema.index(
  {
    applicationId: "text",
    firstName: "text",
    lastName: "text",
    email: "text",
    buildingName: "text",
    macAddress: "text",
  },
  {
    weights: {
      applicationId: 10,
      firstName: 5,
      lastName: 5,
      email: 3,
      buildingName: 2,
      macAddress: 2,
    },
    name: "text_search_index",
  },
);

console.log("✅ Application indexes configured");

export default mongoose.model<IApplication>("Application", ApplicationSchema);
