import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import User from "../models/User";
import Plan from "../models/Plan";
import Payment from "../models/Payment";
import Billing from "../models/Billing";
import BillingCycle from "../models/BillingCycle";
import Application from "../models/Application";
import emailService from "../services/emailService";
import { startBilling as startBillingService } from "./billingController";

interface AuthRequest extends Request {
  user?: any;
  query: any;
  params: any;
  body: any;
}

let dashboardCache: any = null;
let dashboardCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export const getDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = Date.now();
    if (dashboardCache && now - dashboardCacheTime < CACHE_TTL) {
      return res.status(200).json({
        success: true,
        data: dashboardCache,
      });
    }

    const [
      totalUsers,
      activeUsers,
      pendingUsers,
      suspendedUsers,
      totalRevenue,
      monthlyRevenue,
      overdueBills,
      upcomingBills,
      activeBillingCycles,
      pendingPlanChanges,
      monthlyRevenueData,
      userGrowthData,
      planDistribution,
      recentPayments,
      pendingApplications,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: "active" }),
      User.countDocuments({ status: "pending" }),
      User.countDocuments({ status: "suspended" }),
      Payment.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1,
              ),
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Billing.countDocuments({
        status: "overdue",
        dueDate: { $lt: new Date() },
      }),
      Billing.countDocuments({
        status: "sent",
        dueDate: {
          $gte: new Date(),
          $lte: new Date(new Date().setDate(new Date().getDate() + 7)),
        },
      }),
      BillingCycle.countDocuments({ status: "active" }),
      BillingCycle.countDocuments({ "pendingPlanChange.status": "pending" }),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: new Date(new Date().setMonth(new Date().getMonth() - 5)),
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            total: { $sum: "$amount" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      User.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(new Date().setMonth(new Date().getMonth() - 5)),
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      User.aggregate([
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
        { $unwind: "$plan" },
        { $project: { planName: "$plan.name", count: 1 } },
      ]),
      Payment.find({ status: "completed" })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("userId", "firstName lastName email")
        .lean(),
      Application.countDocuments({ status: "pending" }),
    ]);

    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const currentMonth = new Date().getMonth();

    const monthlyRevenueArray = new Array(12).fill(0);
    const monthlyUserArray = new Array(12).fill(0);

    for (const item of monthlyRevenueData) {
      const index = item._id.month - 1;
      monthlyRevenueArray[index] = item.total;
    }

    for (const item of userGrowthData) {
      const index = item._id.month - 1;
      monthlyUserArray[index] = item.total;
    }

    const previousMonthRevenue = monthlyRevenueArray[currentMonth - 1] || 0;
    const currentMonthRevenue = monthlyRevenueArray[currentMonth] || 0;
    const revenueGrowth =
      previousMonthRevenue > 0
        ? Math.round(
            ((currentMonthRevenue - previousMonthRevenue) /
              previousMonthRevenue) *
              100,
          )
        : currentMonthRevenue > 0
          ? 100
          : 0;

    const previousMonthUsers = monthlyUserArray[currentMonth - 1] || 0;
    const currentMonthUsers = monthlyUserArray[currentMonth] || 0;
    const userGrowth =
      previousMonthUsers > 0
        ? Math.round(
            ((currentMonthUsers - previousMonthUsers) / previousMonthUsers) *
              100,
          )
        : currentMonthUsers > 0
          ? 100
          : 0;

    const totalActiveUsers = activeUsers;
    const totalActivePercentage =
      totalUsers > 0 ? Math.round((totalActiveUsers / totalUsers) * 100) : 0;

    const result = {
      users: {
        total: totalUsers,
        active: totalActiveUsers,
        pending: pendingUsers,
        suspended: suspendedUsers,
        newThisMonth: currentMonthUsers,
        growth: userGrowth,
        monthlyGrowth: userGrowth,
        activeGrowth: totalActivePercentage,
        growthLabels: months,
        growthData: monthlyUserArray,
      },
      revenue: {
        total: totalRevenue[0]?.total || 0,
        monthly: monthlyRevenue[0]?.total || 0,
        monthlyTotal: currentMonthRevenue,
        growth: revenueGrowth,
        monthlyGrowth: revenueGrowth,
        monthlyLabels: months,
        monthlyData: monthlyRevenueArray,
      },
      plans: planDistribution,
      recentPayments: recentPayments,
      billing: {
        overdue: overdueBills,
        upcoming: upcomingBills,
        activeCycles: activeBillingCycles,
        pendingChanges: pendingPlanChanges,
      },
      applications: {
        pending: pendingApplications,
      },
    };

    dashboardCache = result;
    dashboardCacheTime = now;

    res.status(200).json({
      success: true,
      data: result,
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
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const limitNum = parseInt(limit as string);

    let query: any = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .populate("planId")
        .limit(limitNum)
        .skip(skip)
        .sort({ createdAt: -1 })
        .lean(),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: users,
      totalPages: Math.ceil(total / limitNum),
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
    const userId = req.params.id;

    const [user, payments, bills, billingCycle] = await Promise.all([
      User.findById(userId).select("-password").populate("planId").lean(),
      Payment.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
      Billing.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
      BillingCycle.findOne({ userId, status: "active" })
        .populate("planId")
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: { user, payments, bills, billingCycle },
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

    dashboardCache = null;

    const updatedUser = await User.findById(user._id)
      .select("-password")
      .populate("planId")
      .lean();

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

    dashboardCache = null;

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

    dashboardCache = null;

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

    dashboardCache = null;

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
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const limitNum = parseInt(limit as string);

    let query: any = {};
    if (status) query.status = status;

    const [payments, total, stats, monthlyStats] = await Promise.all([
      Payment.find(query)
        .populate("userId", "firstName lastName email username")
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip(skip)
        .lean(),
      Payment.countDocuments(query),
      Payment.aggregate([
        { $match: { status: "completed" } },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1,
              ),
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
      ]),
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
      totalPages: Math.ceil(total / limitNum),
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
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const limitNum = parseInt(limit as string);

    let query: any = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;

    const [bills, total, stats] = await Promise.all([
      Billing.find(query)
        .populate("userId", "firstName lastName email username")
        .populate("paymentId")
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip(skip)
        .lean(),
      Billing.countDocuments(query),
      Billing.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            totalAmount: { $sum: "$total" },
          },
        },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: bills,
      stats,
      totalPages: Math.ceil(total / limitNum),
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
              createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
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
              createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
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
          { $group: { _id: "$planId", count: { $sum: 1 } } },
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
              createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
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
        return res
          .status(400)
          .json({ success: false, message: "Invalid report type" });
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
      metadata: { type, startDate, endDate, generatedAt: new Date() },
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
    const [recentPayments, recentUsers, recentBills, recentApplications] =
      await Promise.all([
        Payment.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("userId", "firstName lastName email")
          .lean(),
        User.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .select("firstName lastName email createdAt status")
          .lean(),
        Billing.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("userId", "firstName lastName email")
          .lean(),
        Application.find({ status: "pending" })
          .sort({ createdAt: -1 })
          .limit(3)
          .select("firstName lastName email applicationId status createdAt")
          .lean(),
      ]);

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

    for (const app of recentApplications) {
      activities.push({
        title: "New Application",
        description: `${app.firstName} ${app.lastName} applied with ID ${app.applicationId}`,
        type: "application",
        icon: "📝",
        time: getTimeAgo(app.createdAt),
        date: app.createdAt,
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

// ==================== MANUAL CUSTOMER CREATION (UPDATED) ====================
export const createManualCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      buildingId,
      buildingName,
      floor,
      unitNumber,
      planId,
      idType,
      idNumber,
      startBillingImmediately,
      installationDate,
      notes,
    } = req.body;

    if (!firstName || !lastName || !email || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "First name, last name, email, and phone number are required",
      });
    }

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Plan selection is required",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    // CREATE APPLICATION ONLY - NO USER ACCOUNT YET
    const application = await Application.create(
      [
        {
          firstName,
          lastName,
          email: email.toLowerCase(),
          phoneNumber,
          buildingId: buildingId || null,
          buildingName: buildingName || "Manual Entry",
          floor: floor || "",
          unitNumber: unitNumber || "",
          notes: notes || "Manually created by admin",
          planId,
          idType: idType || "N/A",
          idNumber: idNumber || "MANUAL-" + Date.now(),
          idImage: "",
          status: "approved",
          reviewedBy: req.user?._id,
          reviewedAt: new Date(),
          approvalEmailSent: true,
          billingStarted: startBillingImmediately || false,
        },
      ],
      { session },
    );

    const appDoc = application[0];
    let billingResult = null;

    // START BILLING IMMEDIATELY IF REQUESTED
    if (startBillingImmediately) {
      try {
        const generatedPassword = Math.random().toString(36).slice(-8);
        let username =
          `${firstName.toLowerCase()}.${lastName.toLowerCase()}`.replace(
            /[^a-z0-9.]/g,
            "",
          );
        let finalUsername = username;
        let counter = 1;
        while (await User.findOne({ username: finalUsername })) {
          finalUsername = `${username}${counter}`;
          counter++;
        }

        const userData: any = {
          username: finalUsername,
          email: email.toLowerCase(),
          password: generatedPassword,
          firstName,
          lastName,
          phoneNumber,
          buildingId: buildingId || null,
          buildingName: buildingName || "Manual Entry",
          floor: floor || "",
          unitNumber: unitNumber || "",
          planId,
          status: "pending_activation",
          mikrotik: {
            username: finalUsername,
            password: generatedPassword,
            profile: plan.mikrotikProfile || "default",
            ipAddress: "",
            macAddress: "",
          },
          billingInfo: {
            currentBill: 0,
            autoPay: false,
          },
        };

        const user = await User.create([userData], { session });
        const userDoc = user[0];

        appDoc.registeredUserId = userDoc._id;
        await appDoc.save({ session });

        const billingReq = {
          body: {
            userId: userDoc._id.toString(),
            startDate: installationDate,
            notes: notes || "Manual customer created by admin",
          },
          user: req.user,
        } as any;

        let capturedData: any = null;
        const billingRes = {
          status: (code: number) => ({
            json: (data: any) => {
              capturedData = data;
              return data;
            },
          }),
        } as any;

        await startBillingService(billingReq, billingRes, next);
        billingResult = capturedData;

        // UPDATED: Use sendWelcomeEmail instead of direct sendEmail
        await emailService.sendWelcomeEmail(userDoc);
      } catch (billingError) {
        console.error("Error starting billing:", billingError);
      }
    } else {
      // UPDATED: Use sendApplicationApproved instead of direct sendEmail
      await emailService.sendApplicationApproved(appDoc, plan);
    }

    await session.commitTransaction();
    dashboardCache = null;

    res.status(201).json({
      success: true,
      message: startBillingImmediately
        ? "Customer created and billing started successfully!"
        : "Customer created successfully! An approval email has been sent with registration link. No account was created yet.",
      data: {
        application: {
          id: appDoc._id,
          applicationId: appDoc.applicationId,
        },
        billing: billingResult?.data || null,
      },
    });
  } catch (error: any) {
    await session.abortTransaction();
    console.error("Manual customer creation error:", error);
    next(error);
  } finally {
    session.endSession();
  }
};

// ==================== GET CUSTOMERS WITHOUT ACCOUNTS ====================
export const getCustomersWithoutAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("🔍 [ADMIN] Fetching customers without accounts...");

    const applications = await Application.find({
      status: "approved",
      $or: [
        { registeredUserId: { $exists: false } },
        { registeredUserId: null },
      ],
      billingStarted: { $ne: true },
    })
      .populate("planId", "name price speed")
      .sort({ createdAt: -1 })
      .lean();

    console.log(
      `✅ [ADMIN] Found ${applications.length} approved applications without user accounts`,
    );

    applications.forEach((app, index) => {
      console.log(
        `  ${index + 1}. ${app.firstName} ${app.lastName} - ${app.applicationId}`,
      );
    });

    res.status(200).json({
      success: true,
      data: applications,
      count: applications.length,
    });
  } catch (error) {
    console.error("Error in getCustomersWithoutAccounts:", error);
    next(error);
  }
};
