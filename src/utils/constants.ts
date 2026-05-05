export const USER_ROLES = {
    USER: 'user',
    ADMIN: 'admin',
    STAFF: 'staff'
} as const;

export const USER_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
    PENDING: 'pending'
} as const;

export const PAYMENT_METHODS = {
    PAYMONGO: 'paymongo',
    DRAGONPAY: 'dragonpay',
    GCASH: 'gcash',
    MAYA: 'maya',
    CARD: 'card',
    BANK_TRANSFER: 'bank_transfer'
} as const;

export const PAYMENT_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded'
} as const;

export const BILLING_STATUS = {
    DRAFT: 'draft',
    SENT: 'sent',
    PAID: 'paid',
    OVERDUE: 'overdue',
    CANCELLED: 'cancelled'
} as const;

export const ID_TYPES = {
    DRIVERS_LICENSE: 'drivers_license',
    PASSPORT: 'passport',
    NATIONAL_ID: 'national_id',
    PRC_ID: 'prc_id'
} as const;

export const NOTIFICATION_TYPES = {
    EMAIL: 'email',
    SMS: 'sms',
    PUSH: 'push',
    SYSTEM: 'system'
} as const;

export const NOTIFICATION_PRIORITY = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent'
} as const;

export const SPEED_UNITS = {
    MBPS: 'Mbps',
    GBPS: 'Gbps'
} as const;

export const PAYMENT_TYPES = {
    SUBSCRIPTION: 'subscription',
    INSTALLATION: 'installation',
    OTHERS: 'others'
} as const;

// Default values
export const DEFAULT_PLAN_DURATION = 30; // days
export const DEFAULT_BILLING_CYCLE = 30; // days
export const DEFAULT_GRACE_PERIOD = 3; // days
export const MAX_LOGIN_ATTEMPTS = 5;
export const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// API endpoints
export const API_ENDPOINTS = {
    AUTH: {
        REGISTER: '/api/auth/register',
        LOGIN: '/api/auth/login',
        LOGOUT: '/api/auth/logout',
        ME: '/api/auth/me',
        UPDATE_PASSWORD: '/api/auth/update-password',
        FORGOT_PASSWORD: '/api/auth/forgot-password',
        RESET_PASSWORD: '/api/auth/reset-password'
    },
    USERS: {
        PROFILE: '/api/users/profile',
        CHANGE_PLAN: '/api/users/change-plan',
        USAGE: '/api/users/usage'
    },
    PLANS: {
        BASE: '/api/plans',
        FEATURES: '/api/plans/features',
        COMPARE: '/api/plans/compare'
    },
    PAYMENTS: {
        BASE: '/api/payments',
        VERIFY: '/api/payments/verify',
        WEBHOOK: {
            PAYMONGO: '/api/payments/webhook/paymongo',
            DRAGONPAY: '/api/payments/webhook/dragonpay'
        },
        STATS: '/api/payments/stats'
    },
    BILLING: {
        BASE: '/api/billing',
        CURRENT: '/api/billing/current',
        HISTORY: '/api/billing/history',
        INVOICE: '/api/billing/invoice'
    },
    MIKROTIK: {
        BASE: '/api/mikrotik',
        STATUS: '/api/mikrotik/status',
        USERS: '/api/mikrotik/users',
        ACTIVE: '/api/mikrotik/active',
        TRAFFIC: '/api/mikrotik/traffic',
        INTERFACES: '/api/mikrotik/interfaces',
        QUEUES: '/api/mikrotik/queues'
    },
    ADMIN: {
        DASHBOARD: '/api/admin/dashboard',
        USERS: '/api/admin/users',
        PAYMENTS: '/api/admin/payments',
        BILLS: '/api/admin/bills',
        REPORTS: '/api/admin/reports'
    }
} as const;

// Error messages
export const ERROR_MESSAGES = {
    UNAUTHORIZED: 'You are not authorized to access this resource',
    INVALID_CREDENTIALS: 'Invalid email or password',
    USER_NOT_FOUND: 'User not found',
    PLAN_NOT_FOUND: 'Plan not found',
    PAYMENT_NOT_FOUND: 'Payment not found',
    BILLING_NOT_FOUND: 'Billing record not found',
    ACCOUNT_SUSPENDED: 'Your account has been suspended',
    ACCOUNT_PENDING: 'Your account is pending approval',
    INVALID_TOKEN: 'Invalid or expired token',
    TOKEN_REQUIRED: 'Authentication token is required',
    VALIDATION_ERROR: 'Validation error',
    SERVER_ERROR: 'Internal server error',
    DUPLICATE_ENTRY: 'Entry already exists',
    INSUFFICIENT_FUNDS: 'Insufficient funds',
    PAYMENT_FAILED: 'Payment processing failed',
    MIKROTIK_CONNECTION_FAILED: 'Failed to connect to MikroTik router',
    MIKROTIK_CONFIG_NOT_FOUND: 'MikroTik configuration not found'
} as const;

// Success messages
export const SUCCESS_MESSAGES = {
    LOGIN_SUCCESS: 'Login successful',
    LOGOUT_SUCCESS: 'Logout successful',
    REGISTER_SUCCESS: 'Registration successful',
    PASSWORD_UPDATED: 'Password updated successfully',
    PASSWORD_RESET_EMAIL_SENT: 'Password reset email sent',
    PASSWORD_RESET_SUCCESS: 'Password reset successful',
    PAYMENT_SUCCESS: 'Payment processed successfully',
    PAYMENT_REFUNDED: 'Payment refunded successfully',
    BILLING_CREATED: 'Billing record created successfully',
    USER_APPROVED: 'User approved successfully',
    USER_SUSPENDED: 'User suspended successfully',
    PLAN_APPLIED: 'Plan applied successfully',
    MIKROTIK_CONFIGURED: 'MikroTik configured successfully'
} as const;