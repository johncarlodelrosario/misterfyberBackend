// controllers/adminController.ts - COMPLETE FIXED FILE (NO DUPLICATES)
import { Request, Response, NextFunction } from "express";
import User from "../models/User";
import Plan from "../models/Plan";
import Payment from "../models/Payment";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";

interface AuthRequest extends Request {
  user?: any;
}

export const getDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: "active" });
    const pendingUsers = await User.countDocuments({ status: "pending" });
    const suspendedUsers = await User.countDocuments({ status: "suspended" });

    const totalRevenue = await Payment.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const monthlyRevenue = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const planDistribution = await User.aggregate([
      { $match: { planId: { $ne: null } } },
      { $group: { _id: "$planId", count: { $sum: 1 } } },
      {
        $lookup: {
          from: "plans",
          localField: "_id",
          foreignField: "_id",
          as: "plan",
        },
      },
    ]);

    const recentPayments = await Payment.find({ status: "completed" })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("userId", "firstName lastName email");

    const overdueBills = await Billing.countDocuments({
      status: "overdue",
      dueDate: { $lt: new Date() },
    });

    const upcomingBills = await Billing.countDocuments({
      status: "sent",
      dueDate: {
        $gte: new Date(),
        $lte: new Date(new Date().setDate(new Date().getDate() + 7)),
      },
    });

    const activeBillingCycles = await BillingCycle.countDocuments({
      status: "active",
    });
    const pendingPlanChanges = await BillingCycle.countDocuments({
      "pendingPlanChange.status": "pending",
    });

    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          pending: pendingUsers,
          suspended: suspendedUsers,
        },
        revenue: {
          total: totalRevenue[0]?.total || 0,
          monthly: monthlyRevenue[0]?.total || 0,
        },
        plans: planDistribution,
        recentPayments,
        billing: {
          overdue: overdueBills,
          upcoming: upcomingBills,
          activeCycles: activeBillingCycles,
          pendingChanges: pendingPlanChanges,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;

    let query: any = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .select("-password")
      .populate("planId")
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: users,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total,
    });
  } catch (error) {
    next(error);
  }
};

export const getUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("planId");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const payments = await Payment.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    const bills = await Billing.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    const billingCycle = await BillingCycle.findOne({
      userId: user._id,
      status: "active",
    }).populate("planId");

    res.status(200).json({
      success: true,
      data: {
        user,
        payments,
        bills,
        billingCycle,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const {
      firstName,
      lastName,
      phoneNumber,
      address,
      planId,
      status,
      mikrotik,
    } = req.body;

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = { ...user.address, ...address };
    if (planId) user.planId = planId;
    if (status) user.status = status;
    if (mikrotik) user.mikrotik = { ...user.mikrotik, ...mikrotik };

    await user.save();

    const updatedUser = await User.findById(user._id)
      .select("-password")
      .populate("planId");

    res.status(200).json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.status = "inactive";
    await user.save();

    const billingCycle = await BillingCycle.findOne({
      userId: user._id,
      status: "active",
    });
    if (billingCycle) {
      billingCycle.status = "cancelled";
      await billingCycle.save();
    }

    res.status(200).json({
      success: true,
      message: "User deactivated successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const approveUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.status = "active";
    await user.save();

    if (!user.mikrotik || !user.mikrotik.username) {
      if (!user.mikrotik) {
        user.mikrotik = {
          username: "",
          password: "",
          profile: "",
          ipAddress: "",
          macAddress: "",
        };
      }
      user.mikrotik.username = user.username;
      user.mikrotik.password = Math.random().toString(36).slice(-8);
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "User approved successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const suspendUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.status = "suspended";
    await user.save();

    const billingCycle = await BillingCycle.findOne({
      userId: user._id,
      status: "active",
    });
    if (billingCycle) {
      billingCycle.status = "paused";
      billingCycle.serviceSuspendedAt = new Date();
      await billingCycle.save();
    }

    res.status(200).json({
      success: true,
      message: "User suspended successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getAllPayments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    let query: any = {};
    if (status) {
      query.status = status;
    }

    const payments = await Payment.find(query)
      .populate("userId", "firstName lastName email username")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Payment.countDocuments(query);

    const stats = await Payment.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const monthlyStats = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      stats: {
        total: stats[0]?.totalAmount || 0,
        totalCount: stats[0]?.count || 0,
        monthly: monthlyStats[0]?.totalAmount || 0,
        monthlyCount: monthlyStats[0]?.count || 0,
      },
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllBills = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 10, status, userId } = req.query;

    let query: any = {};
    if (status) {
      query.status = status;
    }
    if (userId) {
      query.userId = userId;
    }

    const bills = await Billing.find(query)
      .populate("userId", "firstName lastName email username")
      .populate("paymentId")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Billing.countDocuments(query);

    const stats = await Billing.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$total" },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: bills,
      stats,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total,
    });
  } catch (error) {
    next(error);
  }
};

export const generateReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { type, startDate, endDate, format } = req.body;

    let data: any = {};

    switch (type) {
      case "revenue":
        data = await Payment.aggregate([
          {
            $match: {
              status: "completed",
              createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" },
              },
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
        ]);
        break;

      case "users":
        data = await User.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
        ]);
        break;

      case "plans":
        data = await User.aggregate([
          { $match: { planId: { $ne: null } } },
          {
            $group: {
              _id: "$planId",
              count: { $sum: 1 },
            },
          },
          {
            $lookup: {
              from: "plans",
              localField: "_id",
              foreignField: "_id",
              as: "plan",
            },
          },
          { $unwind: "$plan" },
          {
            $project: {
              planName: "$plan.name",
              planPrice: "$plan.price",
              count: 1,
            },
          },
        ]);
        break;

      case "billing":
        data = await Billing.aggregate([
          {
            $match: {
              createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
              },
            },
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
              totalAmount: { $sum: "$total" },
            },
          },
        ]);
        break;

      default:
        return res.status(400).json({
          success: false,
          message: "Invalid report type",
        });
    }

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=report-${type}.csv`,
      );
      return res.status(200).send(JSON.stringify(data));
    }

    res.status(200).json({
      success: true,
      data,
      metadata: {
        type,
        startDate,
        endDate,
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getRecentActivities = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const recentPayments = await Payment.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "firstName lastName email");

    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("firstName lastName email createdAt status");

    const recentBills = await Billing.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "firstName lastName email");

    const activities = [];

    for (const payment of recentPayments) {
      const user = payment.userId as any;
      const userName =
        user && user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user && user.email
            ? user.email
            : "Unknown User";

      activities.push({
        title: "Payment Received",
        description: `${userName} paid ₱${payment.amount?.toLocaleString() || 0}`,
        type: "payment",
        icon: "💰",
        time: getTimeAgo(payment.createdAt),
        date: payment.createdAt,
      });
    }

    for (const user of recentUsers) {
      activities.push({
        title: "New User Registered",
        description: `${user.firstName} ${user.lastName} created an account`,
        type: "user",
        icon: "👤",
        time: getTimeAgo(user.createdAt),
        date: user.createdAt,
      });
    }

    for (const bill of recentBills) {
      if (bill.status === "overdue") {
        const user = bill.userId as any;
        const userName =
          user && user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user && user.email
              ? user.email
              : "Unknown User";

        activities.push({
          title: "Bill Overdue",
          description: `${userName} has an overdue bill of ₱${bill.total?.toLocaleString() || 0}`,
          type: "alert",
          icon: "⚠️",
          time: getTimeAgo(bill.dueDate),
          date: bill.dueDate,
        });
      }
    }

    activities.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    res.status(200).json({
      success: true,
      data: activities.slice(0, 10),
    });
  } catch (error) {
    console.error("Error in getRecentActivities:", error);
    next(error);
  }
};

const getTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
};

export default {
  getDashboardStats,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  approveUser,
  suspendUser,
  getAllPayments,
  getAllBills,
  generateReport,
  getRecentActivities,
};
