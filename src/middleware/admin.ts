import { Request, Response, NextFunction } from 'express';
import { protect } from './auth';

export const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).user) {
        return res.status(401).json({ message: 'Not authorized' });
    }

    if ((req as any).user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }

    next();
};

export const staffOrAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).user) {
        return res.status(401).json({ message: 'Not authorized' });
    }

    const role = (req as any).user.role;
    if (role !== 'admin' && role !== 'staff') {
        return res.status(403).json({ message: 'Staff or admin access required' });
    }

    next();
};