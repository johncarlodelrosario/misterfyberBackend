// middleware/upload.ts
import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import sharp from "sharp";

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

// Memory storage before uploading to Cloudinary
const memoryStorage = multer.memoryStorage();

// File filter function
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(
      new Error("Only images (jpeg, jpg, png, gif, webp) and PDFs are allowed"),
    );
  }
};

const limits = {
  fileSize: 5 * 1024 * 1024, // 5MB
  files: 5,
};

// ============================================================
// ✅ SERVER-SIDE IMAGE COMPRESSION WITH SHARP
// ============================================================
const compressImageBuffer = async (
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; mimetype: string }> => {
  // Only compress images, not PDFs
  if (mimetype === "application/pdf") {
    return { buffer, mimetype };
  }

  try {
    console.log(
      `🗜️ Server compressing image: ${(buffer.length / 1024).toFixed(0)}KB`,
    );

    const compressedBuffer = await sharp(buffer)
      .rotate() // ✅ Auto-rotate based on EXIF (fix sideways photos)
      .resize(1280, 1280, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75, progressive: true, mozjpeg: true })
      .toBuffer();

    console.log(
      `✅ Server compressed: ${(buffer.length / 1024).toFixed(0)}KB → ${(compressedBuffer.length / 1024).toFixed(0)}KB`,
    );

    return { buffer: compressedBuffer, mimetype: "image/jpeg" };
  } catch (error) {
    console.error("❌ Sharp compression failed:", error);
    return { buffer, mimetype };
  }
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
        // ✅ Cloudinary also compresses
        transformation: [
          { width: 1280, height: 1280, crop: "limit" },
          { quality: "auto:good" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result?.secure_url || "");
      },
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Use Cloudinary (auto-detect if credentials exist)
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

// ============================================================
// ✅ MIDDLEWARE: Process upload with compression
// ============================================================
export const processIdCardUpload = async (req: any, res: any, next: any) => {
  if (!req.file) return next();

  try {
    // ✅ STEP 1: Compress the image buffer with Sharp
    const { buffer: compressedBuffer, mimetype: compressedMimetype } =
      await compressImageBuffer(req.file.buffer, req.file.mimetype);

    req.file.buffer = compressedBuffer;
    req.file.mimetype = compressedMimetype;
    req.file.originalname =
      req.file.originalname.replace(/\.[^/.]+$/, "") + ".jpg";

    if (useCloudinary) {
      // ✅ STEP 2: Upload to Cloudinary
      const imageUrl = await uploadToCloudinary(
        compressedBuffer,
        "misterfyber/id-cards",
        req.file.originalname,
      );
      req.file.cloudinaryUrl = imageUrl;
      req.file.path = imageUrl;
      console.log(`✅ Uploaded to Cloudinary: ${imageUrl}`);
      next();
    } else {
      // ✅ STEP 2: Save locally
      const filename = req.file.originalname.replace(/\s/g, "_");
      const filepath = path.join(process.cwd(), "uploads/id-cards", filename);
      fs.writeFileSync(filepath, compressedBuffer);
      req.file.path = `uploads/id-cards/${filename}`;
      console.log(`✅ Saved locally: ${req.file.path}`);
      next();
    }
  } catch (error) {
    console.error("Upload processing error:", error);
    next(error);
  }
};

// ============================================================
// ✅ EXPORT: Single upload with compression
// ============================================================
export const uploadIdCardSingle = (req: any, res: any, next: any) => {
  uploadIdCard.single("idImage")(req, res, (err: any) => {
    if (err) return next(err);
    if (req.file) {
      processIdCardUpload(req, res, next);
    } else {
      next();
    }
  });
};

export const uploadPaymentProofSingle = (req: any, res: any, next: any) => {
  uploadPaymentProof.single("paymentProof")(req, res, (err: any) => {
    if (err) return next(err);
    if (req.file) {
      processIdCardUpload(req, res, next);
    } else {
      next();
    }
  });
};

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
    process.env.BASE_URL || "https://misterfyberbackend-lvjd.onrender.com";
  let cleanPath = filePath.replace(/\\/g, "/");
  if (!cleanPath.startsWith("uploads/")) {
    cleanPath = `uploads/${cleanPath}`;
  }

  return `${baseUrl}/${cleanPath}`;
};
