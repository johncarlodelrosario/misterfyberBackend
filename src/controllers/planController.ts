// backend/src/controllers/planController.ts - WITH CACHE!

import { Request, Response, NextFunction } from "express";
import Plan from "../models/Plan";

// ============================================================
// 🔥 CACHE FOR PLANS - SOBRANG BILIS!
// ============================================================
let plansCache: any[] = [];
let plansCacheTimestamp = 0;
const PLANS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let planFeaturesCache: any[] = [];
let planFeaturesCacheTimestamp = 0;
const PLAN_FEATURES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// @desc    Get all plans
// @route   GET /api/plans
// @access  Public
export const getPlans = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();

    // Check cache
    if (plansCache.length > 0 && now - plansCacheTimestamp < PLANS_CACHE_TTL) {
      console.log("📦 Returning cached plans");
      return res.status(200).json({
        success: true,
        count: plansCache.length,
        data: plansCache,
        _cached: true,
      });
    }

    console.log("🔄 Fetching plans from database...");
    const plans = await Plan.find({ isActive: true })
      .sort({ price: 1 })
      .lean()
      .maxTimeMS(5000);

    // Save to cache
    plansCache = plans;
    plansCacheTimestamp = now;

    console.log(`✅ Cached ${plans.length} plans`);

    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
      _cached: false,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single plan
// @route   GET /api/plans/:id
// @access  Public
export const getPlan = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Try to get from cache first
    const cachedPlan = plansCache.find(
      (p) => p._id.toString() === req.params.id,
    );
    if (cachedPlan) {
      return res.status(200).json({
        success: true,
        data: cachedPlan,
        _cached: true,
      });
    }

    const plan = await Plan.findById(req.params.id).lean();

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    res.status(200).json({
      success: true,
      data: plan,
      _cached: false,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create plan
// @route   POST /api/plans
// @access  Private/Admin
export const createPlan = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const plan = await Plan.create(req.body);

    // Clear caches
    plansCache = [];
    plansCacheTimestamp = 0;
    planFeaturesCache = [];
    planFeaturesCacheTimestamp = 0;

    res.status(201).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update plan
// @route   PUT /api/plans/:id
// @access  Private/Admin
export const updatePlan = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    let plan = await Plan.findById(req.params.id);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    plan = await Plan.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    // Clear caches
    plansCache = [];
    plansCacheTimestamp = 0;
    planFeaturesCache = [];
    planFeaturesCacheTimestamp = 0;

    res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete plan
// @route   DELETE /api/plans/:id
// @access  Private/Admin
export const deletePlan = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const plan = await Plan.findById(req.params.id);

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }

    // Soft delete
    plan.isActive = false;
    await plan.save();

    // Clear caches
    plansCache = [];
    plansCacheTimestamp = 0;
    planFeaturesCache = [];
    planFeaturesCacheTimestamp = 0;

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get plan features
// @route   GET /api/plans/features
// @access  Public
export const getPlanFeatures = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();

    // Check cache
    if (
      planFeaturesCache.length > 0 &&
      now - planFeaturesCacheTimestamp < PLAN_FEATURES_CACHE_TTL
    ) {
      console.log("📦 Returning cached plan features");
      return res.status(200).json({
        success: true,
        data: planFeaturesCache,
        _cached: true,
      });
    }

    const plans = await Plan.find({ isActive: true })
      .select("name speed price features")
      .lean()
      .maxTimeMS(5000);

    // Save to cache
    planFeaturesCache = plans;
    planFeaturesCacheTimestamp = now;

    res.status(200).json({
      success: true,
      data: plans,
      _cached: false,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Compare plans
// @route   GET /api/plans/compare
// @access  Public
export const comparePlans = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { planIds } = req.query;

    if (!planIds) {
      return res
        .status(400)
        .json({ message: "Please provide plan IDs to compare" });
    }

    const ids = (planIds as string).split(",");

    // Try to get from cache first
    const cachedPlans = plansCache.filter((p) =>
      ids.includes(p._id.toString()),
    );
    if (cachedPlans.length === ids.length) {
      return res.status(200).json({
        success: true,
        data: cachedPlans,
        _cached: true,
      });
    }

    const plans = await Plan.find({
      _id: { $in: ids },
      isActive: true,
    }).lean();

    res.status(200).json({
      success: true,
      data: plans,
      _cached: false,
    });
  } catch (error) {
    next(error);
  }
};
