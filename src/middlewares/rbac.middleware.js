import { AppError } from './error.middleware.js';

// Role-based access control middleware
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(new AppError('Authentication required', 401));
        }

        if (!roles.includes(req.user.role)) {
            return next(
                new AppError(
                    `Access denied. This action requires ${roles.join(' or ')} role.`,
                    403
                )
            );
        }

        next();
    };
};

// Check if user is student
export const isStudent = authorize('student');

// Check if user is teacher
export const isTeacher = authorize('teacher');

// Check if user is admin
export const isAdmin = authorize('admin');

// Check if user is teacher or admin
export const isTeacherOrAdmin = authorize('teacher', 'admin');

// Check if user is admin or accessing their own resource
export const isAdminOrSelf = (req, res, next) => {
    if (!req.user) {
        return next(new AppError('Authentication required', 401));
    }

    const userId = req.params.userId || req.params.id;

    if (req.user.role === 'admin' || req.user.id === userId) {
        return next();
    }

    return next(new AppError('Access denied. You can only access your own resources.', 403));
};
