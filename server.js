import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './src/config/config.js';
import { errorHandler } from './src/middlewares/error.middleware.js';

// Import routes
import authRoutes from './src/routes/auth.routes.js';
import userRoutes from './src/routes/user.routes.js';
import courseRoutes from './src/routes/course.routes.js';
import chapterRoutes from './src/routes/chapter.routes.js';
import lectureRoutes from './src/routes/lecture.routes.js';
import enrollmentRoutes from './src/routes/enrollment.routes.js';
import paymentRoutes from './src/routes/payment.routes.js';
import streamingRoutes from './src/routes/streaming.routes.js';
import quizRoutes from './src/routes/quiz.routes.js';
import certificateRoutes from './src/routes/certificate.routes.js';
import auditRoutes from './src/routes/audit.routes.js';
import aiRoutes from './src/routes/ai.routes.js';
import deviceRoutes from './src/routes/device.routes.js';
import courseRequestRoutes from './src/routes/courseRequest.routes.js';
import couponRoutes from './src/routes/coupon.routes.js';
import seoRoutes from './src/routes/seo.routes.js';

const app = express();

// Trust proxy - required for Render deployment
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration - Allow Vercel preview deployments
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        // Allow configured frontend URL
        if (origin === config.frontendUrl) {
            return callback(null, true);
        }

        // Allow all Vercel preview deployments (*.vercel.app)
        if (origin.match(/^https:\/\/.*\.vercel\.app$/)) {
            return callback(null, true);
        }

        // Allow localhost for development
        if (origin.match(/^http:\/\/localhost:\d+$/)) {
            return callback(null, true);
        }

        // Reject all other origins
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'AS Academy LMS Backend is running',
        timestamp: new Date().toISOString(),
        environment: config.nodeEnv
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/lectures', lectureRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/streaming', streamingRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/course-requests', courseRequestRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/seo', seoRoutes);

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = config.port;
app.listen(PORT, () => {
    console.log(`🚀 AS Academy LMS Backend running on port ${PORT}`);
    console.log(`📝 Environment: ${config.nodeEnv}`);

    // Display appropriate health check URL based on environment
    const healthUrl = config.nodeEnv === 'production'
        ? `https://your-backend.onrender.com/health (Update this URL after deployment)`
        : `http://localhost:${PORT}/health`;
    console.log(`🔗 Health check: ${healthUrl}`);
});


export default app;
