import { Request, Response, NextFunction } from 'express';
import Plan from '../models/Plan';

// @desc    Get all plans
// @route   GET /api/plans
// @access  Public
export const getPlans = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const plans = await Plan.find({ isActive: true }).sort({ price: 1 });

        res.status(200).json({
            success: true,
            count: plans.length,
            data: plans
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single plan
// @route   GET /api/plans/:id
// @access  Public
export const getPlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const plan = await Plan.findById(req.params.id);

        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        res.status(200).json({
            success: true,
            data: plan
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create plan
// @route   POST /api/plans
// @access  Private/Admin
export const createPlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const plan = await Plan.create(req.body);

        res.status(201).json({
            success: true,
            data: plan
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update plan
// @route   PUT /api/plans/:id
// @access  Private/Admin
export const updatePlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
        let plan = await Plan.findById(req.params.id);

        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        plan = await Plan.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.status(200).json({
            success: true,
            data: plan
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete plan
// @route   DELETE /api/plans/:id
// @access  Private/Admin
export const deletePlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const plan = await Plan.findById(req.params.id);

        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        // Soft delete
        plan.isActive = false;
        await plan.save();

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get plan features
// @route   GET /api/plans/features
// @access  Public
export const getPlanFeatures = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const plans = await Plan.find({ isActive: true }).select('name speed price features');

        res.status(200).json({
            success: true,
            data: plans
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Compare plans
// @route   GET /api/plans/compare
// @access  Public
export const comparePlans = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { planIds } = req.query;
        
        if (!planIds) {
            return res.status(400).json({ message: 'Please provide plan IDs to compare' });
        }

        const ids = (planIds as string).split(',');
        const plans = await Plan.find({ 
            _id: { $in: ids },
            isActive: true 
        });

        res.status(200).json({
            success: true,
            data: plans
        });
    } catch (error) {
        next(error);
    }
};