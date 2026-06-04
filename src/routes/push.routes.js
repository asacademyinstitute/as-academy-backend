import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { supabase } from '../config/database.js';
import { config } from '../config/config.js';

const router = express.Router();

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', asyncHandler(async (req, res) => {
    const publicKey = config.vapid.publicKey;
    if (!publicKey) {
        return res.status(500).json({
            success: false,
            message: 'VAPID public key not configured on server'
        });
    }
    res.json({
        success: true,
        publicKey
    });
}));

// POST /api/push/subscribe
router.post('/subscribe', authenticate, asyncHandler(async (req, res) => {
    const { subscription, deviceType } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({
            success: false,
            message: 'Subscription data (endpoint, keys) is required'
        });
    }

    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;

    // Upsert subscription (if endpoint exists, update keys/user_id, otherwise insert)
    const { data, error } = await supabase
        .from('push_subscriptions')
        .upsert({
            user_id: req.user.id,
            endpoint,
            p256dh,
            auth,
            device_type: deviceType || 'unknown',
            created_at: new Date().toISOString()
        }, {
            onConflict: 'endpoint'
        })
        .select();

    if (error) {
        console.error('Subscription save error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to save push subscription'
        });
    }

    res.json({
        success: true,
        message: 'Push subscription saved successfully',
        data
    });
}));

// POST /api/push/unsubscribe
router.post('/unsubscribe', authenticate, asyncHandler(async (req, res) => {
    const { endpoint } = req.body;

    if (!endpoint) {
        return res.status(400).json({
            success: false,
            message: 'Endpoint is required to unsubscribe'
        });
    }

    const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);

    if (error) {
        console.error('Unsubscribe error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to unsubscribe'
        });
    }

    res.json({
        success: true,
        message: 'Unsubscribed successfully'
    });
}));

export default router;
