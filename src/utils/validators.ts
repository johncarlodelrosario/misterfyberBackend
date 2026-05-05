import { body, ValidationChain } from 'express-validator';

export const validateEmail = (field: string = 'email'): ValidationChain => {
    return body(field)
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email address');
};

export const validatePassword = (field: string = 'password'): ValidationChain => {
    return body(field)
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long')
        .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
        .withMessage('Password must contain at least one letter and one number');
};

export const validatePhoneNumber = (field: string = 'phoneNumber'): ValidationChain => {
    return body(field)
        .isMobilePhone('any')
        .withMessage('Please provide a valid phone number');
};

export const validateMongoId = (field: string): ValidationChain => {
    return body(field)
        .isMongoId()
        .withMessage(`Invalid ${field} format`);
};

export const validateAmount = (field: string = 'amount'): ValidationChain => {
    return body(field)
        .isNumeric()
        .withMessage('Amount must be a number')
        .custom((value) => value > 0)
        .withMessage('Amount must be greater than 0');
};

export const validateDate = (field: string): ValidationChain => {
    return body(field)
        .isISO8601()
        .withMessage(`Please provide a valid date for ${field}`);
};

export const validateIPAddress = (field: string = 'ipAddress'): ValidationChain => {
    return body(field)
        .isIP()
        .withMessage('Please provide a valid IP address');
};

export const validateMACAddress = (field: string = 'macAddress'): ValidationChain => {
    return body(field)
        .matches(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)
        .withMessage('Please provide a valid MAC address');
};