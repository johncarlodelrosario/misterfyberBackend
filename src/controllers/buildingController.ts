import { Request, Response, NextFunction } from "express";
import Building from "../models/Building";
import { validationResult } from "express-validator";

export const createBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      buildingName,
      region,
      province,
      city,
      barangay,
      streetAddress,
      zipCode,
    } = req.body;

    const existingBuilding = await Building.findOne({ buildingName });
    if (existingBuilding) {
      return res.status(400).json({
        success: false,
        message: "Building name already exists",
      });
    }

    const building = await Building.create({
      buildingName,
      region,
      province,
      city,
      barangay,
      streetAddress,
      zipCode: zipCode || "",
    });

    res.status(201).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllBuildings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 10, isActive } = req.query;

    let query: any = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const buildings = await Building.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Building.countDocuments(query);

    res.status(200).json({
      success: true,
      data: buildings,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total,
    });
  } catch (error) {
    next(error);
  }
};

export const getActiveBuildings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const buildings = await Building.find({ isActive: true })
      .select(
        "buildingName region province city barangay streetAddress zipCode",
      )
      .sort({ buildingName: 1 });

    res.status(200).json({
      success: true,
      data: buildings,
    });
  } catch (error) {
    next(error);
  }
};

export const getBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const building = await Building.findById(req.params.id);

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    res.status(200).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

export const updateBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const building = await Building.findById(req.params.id);

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    const {
      buildingName,
      region,
      province,
      city,
      barangay,
      streetAddress,
      zipCode,
      isActive,
    } = req.body;

    if (buildingName && buildingName !== building.buildingName) {
      const existing = await Building.findOne({ buildingName });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Building name already exists",
        });
      }
      building.buildingName = buildingName;
    }

    if (region) building.region = region;
    if (province) building.province = province;
    if (city) building.city = city;
    if (barangay) building.barangay = barangay;
    if (streetAddress) building.streetAddress = streetAddress;
    if (zipCode !== undefined) building.zipCode = zipCode;
    if (isActive !== undefined) building.isActive = isActive;

    await building.save();

    res.status(200).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const building = await Building.findById(req.params.id);

    if (!building) {
      return res.status(404).json({
        success: false,
        message: "Building not found",
      });
    }

    await building.deleteOne();

    res.status(200).json({
      success: true,
      message: "Building deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
