import { Router } from 'express';
import seoService from '../services/seo.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';

const router = Router();

// ==================== PUBLIC ROUTES ====================

// Get all categories
router.get('/categories', asyncHandler(async (req, res) => {
    const categories = await seoService.getAllCategories();

    res.json({
        success: true,
        data: categories
    });
}));

// Get page by slug (public)
router.get('/page/:slug(*)', asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    const page = await seoService.getPageBySlug(slug);

    if (!page) {
        return res.status(404).json({
            success: false,
            message: 'Page not found'
        });
    }

    // Get related pages
    const relatedPages = await seoService.getRelatedPages(page.id);

    res.json({
        success: true,
        data: {
            ...page,
            related_pages: relatedPages
        }
    });
}));

// Get pages by category
router.get('/category/:categoryName', asyncHandler(async (req, res) => {
    const { categoryName } = req.params;
    const { page_type, limit = 50 } = req.query;

    const pages = await seoService.getPagesByCategory(
        categoryName,
        page_type,
        parseInt(limit)
    );

    res.json({
        success: true,
        data: pages
    });
}));

// Get subjects by category
router.get('/category/:categoryName/subjects', asyncHandler(async (req, res) => {
    const { categoryName } = req.params;
    const { semester, scheme, branch } = req.query;

    // Get category ID first
    const categories = await seoService.getAllCategories();
    const category = categories.find(c => c.name === categoryName);

    if (!category) {
        return res.status(404).json({
            success: false,
            message: 'Category not found'
        });
    }

    const subjects = await seoService.getSubjectsByCategory(category.id, {
        semester: semester ? parseInt(semester) : undefined,
        scheme,
        branch
    });

    res.json({
        success: true,
        data: subjects
    });
}));

// Search pages
router.get('/search', asyncHandler(async (req, res) => {
    const { q, category, limit = 20 } = req.query;

    if (!q) {
        return res.status(400).json({
            success: false,
            message: 'Search query is required'
        });
    }

    const results = await seoService.searchPages(q, category, parseInt(limit));

    res.json({
        success: true,
        data: results
    });
}));

// Track PDF download
router.post('/track-download', asyncHandler(async (req, res) => {
    const { page_id } = req.body;

    if (!page_id) {
        return res.status(400).json({
            success: false,
            message: 'Page ID is required'
        });
    }

    const userId = req.user?.id || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await seoService.trackDownload(page_id, userId, ipAddress, userAgent);

    res.json({
        success: true,
        message: 'Download tracked successfully'
    });
}));

// Get sitemap data
router.get('/sitemap', asyncHandler(async (req, res) => {
    const pages = await seoService.getAllPublishedPages();

    res.json({
        success: true,
        data: pages
    });
}));

// ==================== ADMIN ROUTES ====================

// Create new page (admin only)
router.post('/pages', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const page = await seoService.createPage(req.body, req.user.id);

    res.status(201).json({
        success: true,
        data: page,
        message: 'Page created successfully'
    });
}));

// Update page (admin only)
router.put('/pages/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const page = await seoService.updatePage(req.params.id, req.body);

    res.json({
        success: true,
        data: page,
        message: 'Page updated successfully'
    });
}));

// Delete page (admin only)
router.delete('/pages/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    await seoService.deletePage(req.params.id);

    res.json({
        success: true,
        message: 'Page deleted successfully'
    });
}));

// Create subject (admin only)
router.post('/subjects', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const subject = await seoService.createSubject(req.body);

    res.status(201).json({
        success: true,
        data: subject,
        message: 'Subject created successfully'
    });
}));

// Get analytics (admin only)
router.get('/analytics', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { category_id, page_type, limit } = req.query;

    const analytics = await seoService.getAnalytics({
        category_id,
        page_type,
        limit: limit ? parseInt(limit) : undefined
    });

    res.json({
        success: true,
        data: analytics
    });
}));

// Get download stats for a page (admin only)
router.get('/pages/:id/download-stats', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const stats = await seoService.getDownloadStats(req.params.id);

    res.json({
        success: true,
        data: stats
    });
}));

// Add internal link (admin only)
router.post('/internal-links', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { from_page_id, to_page_id, link_text, link_type } = req.body;

    if (!from_page_id || !to_page_id) {
        return res.status(400).json({
            success: false,
            message: 'From page ID and to page ID are required'
        });
    }

    const link = await seoService.addInternalLink(
        from_page_id,
        to_page_id,
        link_text,
        link_type
    );

    if (!link) {
        return res.status(409).json({
            success: false,
            message: 'Link already exists'
        });
    }

    res.status(201).json({
        success: true,
        data: link,
        message: 'Internal link added successfully'
    });
}));

// Remove internal link (admin only)
router.delete('/internal-links', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { from_page_id, to_page_id } = req.body;

    if (!from_page_id || !to_page_id) {
        return res.status(400).json({
            success: false,
            message: 'From page ID and to page ID are required'
        });
    }

    await seoService.removeInternalLink(from_page_id, to_page_id);

    res.json({
        success: true,
        message: 'Internal link removed successfully'
    });
}));

// Add keyword to page (admin only)
router.post('/keywords', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { page_id, keyword, search_volume } = req.body;

    if (!page_id || !keyword) {
        return res.status(400).json({
            success: false,
            message: 'Page ID and keyword are required'
        });
    }

    const keywordData = await seoService.addKeyword(page_id, keyword, search_volume);

    if (!keywordData) {
        return res.status(409).json({
            success: false,
            message: 'Keyword already exists for this page'
        });
    }

    res.status(201).json({
        success: true,
        data: keywordData,
        message: 'Keyword added successfully'
    });
}));

// Update keyword rank (admin only)
router.patch('/keywords/:id/rank', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { current_rank } = req.body;

    if (current_rank === undefined) {
        return res.status(400).json({
            success: false,
            message: 'Current rank is required'
        });
    }

    const keyword = await seoService.updateKeywordRank(req.params.id, current_rank);

    res.json({
        success: true,
        data: keyword,
        message: 'Keyword rank updated successfully'
    });
}));

// Get keywords for a page (admin only)
router.get('/pages/:id/keywords', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const keywords = await seoService.getKeywordsByPage(req.params.id);

    res.json({
        success: true,
        data: keywords
    });
}));

export default router;
