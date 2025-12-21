import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { AppError } from './error.middleware.js';
import supabase from '../config/database.js';
import { validateDevice } from './validateDevice.middleware.js';

export const authenticate = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new AppError('No token provided. Please login.', 401);
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, config.jwtSecret);

        // Get user from database
        const { data: user, error } = await supabase
            .from('users')
            .select('id, name, email, phone, role, status')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            throw new AppError('User not found or token invalid', 401);
        }

        // Check if user is blocked
        if (user.status === 'blocked') {
            throw new AppError('Your account has been blocked. Please contact admin.', 403);
        }

        // CRITICAL: For students ONLY, enforce single active session
        // Check if at least one valid refresh token exists in database
        if (user.role === 'student') {
            const { data: validTokens, error: tokenError } = await supabase
                .from('refresh_tokens')
                .select('id')
                .eq('user_id', user.id)
                .eq('revoked', false)
                .gt('expires_at', new Date().toISOString())
                .limit(1);

            if (tokenError || !validTokens || validTokens.length === 0) {
                throw new AppError('Session expired on another device. Please login again.', 401);
            }
        }

        // Attach user AND decoded JWT data to request
        req.user = {
            ...user,
            userId: decoded.userId, // From JWT
            role: decoded.role,     // From JWT
            deviceId: decoded.deviceId // From JWT (for students only)
        };

        // DO NOT call validateDevice here - it should be added explicitly to protected routes only
        // Auth routes (/login, /signup, /me) should NOT have device validation
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return next(new AppError('Invalid token. Please login again.', 401));
        }
        if (error.name === 'TokenExpiredError') {
            return next(new AppError('Token expired. Please login again.', 401));
        }
        next(error);
    }
};

export const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            req.user = null;
            return next();
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, config.jwtSecret);

        const { data: user } = await supabase
            .from('users')
            .select('id, name, email, phone, role, status')
            .eq('id', decoded.userId)
            .single();

        req.user = user || null;
        next();
    } catch (error) {
        req.user = null;
        next();
    }
};
