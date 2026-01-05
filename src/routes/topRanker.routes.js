import express from 'express';
import topRankerService from '../services/topRanker.service.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';

const router = express.Router();

// Public route - Get active top rankers
router.get('/', asyncHandler(async (req, res) => {
    const rankers = await topRankerService.getActiveTopRankers();
    res.json({
        success: true,
        data: rankers
    });
}));

// Public route - Get visibility setting
router.get('/visibility', asyncHandler(async (req, res) => {
    const enabled = await topRankerService.getVisibilitySetting();
    res.json({
        success: true,
        data: { enabled }
    });
}));

// Admin route - Set visibility setting
router.post('/visibility', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({
            success: false,
            message: 'enabled must be a boolean value'
        });
    }

    const result = await topRankerService.setVisibilitySetting(enabled, req.user.id);
    res.json(result);
}));

// Admin routes - Get all top rankers
router.get('/admin', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const rankers = await topRankerService.getAllTopRankers();
    res.json({
        success: true,
        data: rankers
    });
}));

// Admin routes - Create top ranker
router.post('/', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const ranker = await topRankerService.createTopRanker(req.body);
    res.status(201).json({
        success: true,
        data: ranker,
        message: 'Top ranker created successfully'
    });
}));

// Admin routes - Update top ranker
router.put('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const ranker = await topRankerService.updateTopRanker(req.params.id, req.body);
    res.json({
        success: true,
        data: ranker,
        message: 'Top ranker updated successfully'
    });
}));

// Admin routes - Toggle active status
router.post('/:id/toggle', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const ranker = await topRankerService.toggleTopRanker(req.params.id);
    res.json({
        success: true,
        data: ranker,
        message: `Top ranker ${ranker.is_active ? 'enabled' : 'disabled'} successfully`
    });
}));

// Admin routes - Delete top ranker
router.delete('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await topRankerService.deleteTopRanker(req.params.id);
    res.json(result);
}));

export default router;
