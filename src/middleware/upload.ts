import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log("📦 Cloudinary configured");
console.log(`   Cloud Name: ${process.env.CLOUDINARY_CLOUD_NAME}`);
console.log(
  `   API Key: ${process.env.CLOUDINARY_API_KEY ? "✅ SET" : "❌ NOT SET"}`,
);
console.log(
  `   API Secret: ${process.env.CLOUDINARY_API_SECRET ? "✅ SET" : "❌ NOT SET"}`,
);

// Ensure local upload directories exist (fallback)
const createUploadDirs = () => {
  const dirs = ["uploads/id-cards", "uploads/payments", "uploads/temp"];
  dirs.forEach((dir) => {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`📁 Created directory: ${fullPath}`);
    }
  });
};
createUploadDirs();

// Memory storage muna bago i-upload sa Cloudinary
const memoryStorage = multer.memoryStorage();

// File filter function
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("Only images (jpeg, jpg, png, gif) and PDFs are allowed"));
  }
};

const limits = {
  fileSize: 5 * 1024 * 1024, // 5MB
  files: 5,
};

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (
  buffer: Buffer,
  folder: string,
  originalName: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
    const safeName = nameWithoutExt.replace(/\s/g, "_");

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: safeName,
        resource_type: "auto",
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result?.secure_url || "");
      },
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Local storage fallback
const idCardLocalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads/id-cards/");
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname;
    const safeName = originalName.replace(/\s/g, "_");
    cb(null, safeName);
  },
});

const paymentLocalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads/payments/");
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname;
    const safeName = originalName.replace(/\s/g, "_");
    cb(null, safeName);
  },
});

// Use Cloudinary (auto-detect kung may credentials)
const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

console.log(`📦 Using ${useCloudinary ? "CLOUDINARY" : "LOCAL"} storage`);

// Multer instances
export const uploadIdCard = multer({
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: limits,
});

export const uploadPaymentProof = multer({
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: limits,
});

export const uploadMultiple = multer({
  storage: memoryStorage,
  fileFilter: fileFilter,
  limits: limits,
});

// Middleware to process Cloudinary upload after multer
export const processIdCardUpload = async (req: any, res: any, next: any) => {
  if (!req.file) return next();

  if (useCloudinary) {
    try {
      const imageUrl = await uploadToCloudinary(
        req.file.buffer,
        "misterfyber/id-cards",
        req.file.originalname,
      );
      req.file.cloudinaryUrl = imageUrl;
      req.file.path = imageUrl;
      next();
    } catch (error) {
      console.error("Cloudinary upload error:", error);
      next(error);
    }
  } else {
    // Save locally
    const localStorage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, path.join(process.cwd(), "uploads/id-cards/"));
      },
      filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/\s/g, "_");
        cb(null, safeName);
      },
    });
    const upload = multer({ storage: localStorage }).single("idImage");
    upload(req, res, next);
  }
};

export const uploadIdCardSingle = (req: any, res: any, next: any) => {
  uploadIdCard.single("idImage")(req, res, (err: any) => {
    if (err) return next(err);
    if (req.file && useCloudinary) {
      processIdCardUpload(req, res, next);
    } else {
      next();
    }
  });
};

export const uploadPaymentProofSingle =
  uploadPaymentProof.single("paymentProof");
export const uploadMultipleFiles = uploadMultiple.array("files", 5);

export const getFileUrl = (filePath: string, req?: Request): string => {
  if (!filePath) return "";

  // Cloudinary URL
  if (
    filePath.includes("cloudinary.com") ||
    filePath.startsWith("https://res.cloudinary.com")
  ) {
    return filePath;
  }

  // Data URL
  if (filePath.startsWith("data:")) {
    return filePath;
  }

  // Local storage
  const baseUrl =
    process.env.BASE_URL || "https://misterfyberbackend.onrender.com";
  let cleanPath = filePath.replace(/\\/g, "/");
  if (!cleanPath.startsWith("uploads/")) {
    cleanPath = `uploads/${cleanPath}`;
  }

  return `${baseUrl}/${cleanPath}`;
};
