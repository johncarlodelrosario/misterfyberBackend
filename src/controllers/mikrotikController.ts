import { Request, Response, NextFunction } from "express";
import MikrotikConfig from "../models/MikrotikConfig";
import User from "../models/User";
import Plan from "../models/Plan";
import mikrotikService from "../services/mikrotikService";

interface RouterOSClient {
  menu(path: string): {
    print(): Promise<any[]>;
    add(data: any): Promise<any>;
    remove(id: string): Promise<any>;
    set(id: string, data: any): Promise<any>;
  };
}

// @desc    Get MikroTik status
// @route   GET /api/mikrotik/status
// @access  Private/Admin
export const getStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const config = await MikrotikConfig.findOne({ isActive: true });

    if (!config) {
      return res
        .status(404)
        .json({ message: "No active MikroTik configuration" });
    }

    const systemInfo = await mikrotikService.getSystemInfo();

    res.status(200).json({
      success: true,
      data: systemInfo,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Configure MikroTik
// @route   POST /api/mikrotik/configure
// @access  Private/Admin
export const configure = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { host, port, username, password, settings } = req.body;

    // Deactivate current config
    await MikrotikConfig.updateMany({ isActive: true }, { isActive: false });

    // Create new config
    const config = await MikrotikConfig.create({
      host,
      port,
      username,
      password,
      settings,
      isActive: true,
    });

    // Test connection
    await mikrotikService.connect(config._id.toString());

    res.status(201).json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all users from MikroTik
// @route   GET /api/mikrotik/users
// @access  Private/Admin
export const getUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const config = await MikrotikConfig.findOne({ isActive: true });

    if (!config) {
      return res
        .status(404)
        .json({ message: "No active MikroTik configuration" });
    }

    const client = (await mikrotikService.connect(
      config._id.toString(),
    )) as any;
    const pppUsers = await client.menu("/ppp/secret").print();

    res.status(200).json({
      success: true,
      data: pppUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get active connections
// @route   GET /api/mikrotik/active
// @access  Private/Admin
export const getActiveConnections = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const config = await MikrotikConfig.findOne({ isActive: true });

    if (!config) {
      return res
        .status(404)
        .json({ message: "No active MikroTik configuration" });
    }

    const client = (await mikrotikService.connect(
      config._id.toString(),
    )) as any;
    const active = await client.menu("/ppp/active").print();

    res.status(200).json({
      success: true,
      count: active.length,
      data: active,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user traffic
// @route   GET /api/mikrotik/traffic/:userId
// @access  Private
export const getUserTraffic = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const traffic = await mikrotikService.getUserTraffic(user);

    res.status(200).json({
      success: true,
      data: traffic,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Apply plan to user
// @route   POST /api/mikrotik/apply-plan/:userId
// @access  Private/Admin
export const applyPlanToUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.userId).populate("planId");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.planId) {
      return res.status(400).json({ message: "User has no plan assigned" });
    }

    await mikrotikService.applyPlanToUser(user, user.planId as any);

    res.status(200).json({
      success: true,
      message: "Plan applied successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Disable user
// @route   POST /api/mikrotik/disable/:userId
// @access  Private/Admin
export const disableUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await mikrotikService.disablePPPoEUser(user);

    user.status = "suspended";
    await user.save();

    res.status(200).json({
      success: true,
      message: "User disabled successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Enable user
// @route   POST /api/mikrotik/enable/:userId
// @access  Private/Admin
export const enableUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await mikrotikService.enablePPPoEUser(user);

    user.status = "active";
    await user.save();

    res.status(200).json({
      success: true,
      message: "User enabled successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove user
// @route   DELETE /api/mikrotik/user/:userId
// @access  Private/Admin
export const removeUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await mikrotikService.removeUser(user);

    res.status(200).json({
      success: true,
      message: "User removed from MikroTik",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get interfaces
// @route   GET /api/mikrotik/interfaces
// @access  Private/Admin
export const getInterfaces = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const config = await MikrotikConfig.findOne({ isActive: true });

    if (!config) {
      return res
        .status(404)
        .json({ message: "No active MikroTik configuration" });
    }

    const client = (await mikrotikService.connect(
      config._id.toString(),
    )) as any;
    const interfaces = await client.menu("/interface").print();

    res.status(200).json({
      success: true,
      data: interfaces,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get queues
// @route   GET /api/mikrotik/queues
// @access  Private/Admin
export const getQueues = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const config = await MikrotikConfig.findOne({ isActive: true });

    if (!config) {
      return res
        .status(404)
        .json({ message: "No active MikroTik configuration" });
    }

    const client = (await mikrotikService.connect(
      config._id.toString(),
    )) as any;
    const queues = await client.menu("/queue/simple").print();

    res.status(200).json({
      success: true,
      data: queues,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Test connection
// @route   POST /api/mikrotik/test
// @access  Private/Admin
export const testConnection = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { host, port, username, password } = req.body;

    const config = await MikrotikConfig.create({
      host,
      port,
      username,
      password,
      isActive: false,
    });

    await mikrotikService.connect(config._id.toString());
    await mikrotikService.disconnect(config._id.toString());
    await MikrotikConfig.findByIdAndDelete(config._id);

    res.status(200).json({
      success: true,
      message: "Connection successful",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Connection failed",
    });
  }
};
