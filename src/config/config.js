import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // Server
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // JWT
    jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production',
    jwtExpiresIn: '15m', // Access token expires in 15 minutes
    jwtRefreshExpiresIn: '7d', // Refresh token expires in 7 days

    // Supabase
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },

    // Razorpay
    razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
    },

    // Backblaze B2
    backblaze: {
        applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
        applicationKey: process.env.B2_APPLICATION_KEY,
        bucketId: process.env.B2_BUCKET_ID,
        bucketName: process.env.B2_BUCKET_NAME,
        endpoint: process.env.B2_ENDPOINT,
    },

    // CloudFront
    cloudfront: {
        distributionDomain: process.env.CLOUDFRONT_DOMAIN,
        privateKeyPath: process.env.CLOUDFRONT_PRIVATE_KEY_PATH,
        keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
        signedUrlExpiry: 30, // seconds
    },

    // Email (NodeMailer)
    email: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD,
        from: process.env.EMAIL_FROM || 'noreply@asacademy.com',
    },

    // AI Assistant (OpenAI or similar)
    ai: {
        apiKey: process.env.AI_API_KEY,
        model: process.env.AI_MODEL || 'gpt-3.5-turbo',
    },

    // Frontend URL - MUST be set in production
    frontendUrl: process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),


    // Security
    bcryptRounds: 10,
    maxDevicesPerStudent: 1,

    // Rate Limiting
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
    },
};
