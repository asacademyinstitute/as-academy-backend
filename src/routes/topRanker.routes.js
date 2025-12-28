import express from 'express';
import topRankerService from '../services/topRanker.service.js';
import { authenticate, isAdmin } from '../middlewares/auth.middleware.js';
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
