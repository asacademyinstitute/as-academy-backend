import { body, param, query, validationResult } from 'express-validator';
import { AppError } from './error.middleware.js';

// Validation result handler
export const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => err.msg).join(', ');
        return next(new AppError(errorMessages, 400));
    }
    next();
};

// User validation rules
export const registerValidation = [
    body('name')
        .trim()
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email'),
    body('phone')
        .trim()
        .notEmpty().withMessage('Phone number is required')
        .matches(/^[0-9]{10}$/).withMessage('Please provide a valid 10-digit phone number'),
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('college_name')
        .optional()
        .trim(),
    body('semester')
        .optional()
        .trim(),
    validate
];

export const loginValidation = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email'),
    body('password')
        .notEmpty().withMessage('Password is required'),
    validate
];

// Course validation rules
export const createCourseValidation = [
    body('title')
        .trim()
        .notEmpty().withMessage('Course title is required')
        .isLength({ min: 3, max: 500 }).withMessage('Title must be between 3 and 500 characters'),
    body('description')
        .optional()
        .trim(),
    body('price')
        .notEmpty().withMessage('Price is required')
        .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('validity_days')
        .notEmpty().withMessage('Validity days is required')
        .isInt({ min: 1 }).withMessage('Validity must be at least 1 day'),
    body('teacher_id')
        .optional()
        .isUUID().withMessage('Invalid teacher ID'),
    validate
];

// Chapter validation rules
export const createChapterValidation = [
    body('course_id')
        .notEmpty().withMessage('Course ID is required')
        .isUUID().withMessage('Invalid course ID'),
    body('title')
        .trim()
        .notEmpty().withMessage('Chapter title is required')
        .isLength({ min: 3, max: 500 }).withMessage('Title must be between 3 and 500 characters'),
    body('chapter_order')
        .notEmpty().withMessage('Chapter order is required')
        .isInt({ min: 1 }).withMessage('Chapter order must be a positive integer'),
    validate
];

// Lecture validation rules
export const createLectureValidation = [
    body('chapter_id')
        .notEmpty().withMessage('Chapter ID is required')
        .isUUID().withMessage('Invalid chapter ID'),
    body('title')
        .trim()
        .notEmpty().withMessage('Lecture title is required')
        .isLength({ min: 3, max: 500 }).withMessage('Title must be between 3 and 500 characters'),
    body('type')
        .notEmpty().withMessage('Lecture type is required')
        .isIn(['video', 'pdf', 'text']).withMessage('Type must be video, pdf, or text'),
    body('lecture_order')
        .notEmpty().withMessage('Lecture order is required')
        .isInt({ min: 1 }).withMessage('Lecture order must be a positive integer'),
    validate
];

// UUID param validation
export const uuidParamValidation = (paramName = 'id') => [
    param(paramName)
        .isUUID().withMessage(`Invalid ${paramName}`),
    validate
];

// Pagination validation
export const paginationValidation = [
    query('page')
        .optional()
        .isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    validate
];
