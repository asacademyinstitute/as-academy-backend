/**
 * Sitemap Generator Utility
 * Generates XML sitemap for SEO pages
 */

import seoService from '../services/seo.service.js';

class SitemapGenerator {
    /**
     * Generate XML sitemap for all published SEO pages
     * @param {string} baseUrl - Base URL of the website (e.g., 'https://asacademy.com')
     * @returns {string} XML sitemap string
     */
    async generateSitemap(baseUrl = 'https://asacademy.com') {
        const pages = await seoService.getAllPublishedPages();

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Add homepage
        xml += this.createUrlEntry(baseUrl, new Date().toISOString(), 'daily', '1.0');

        // Add SEO pages
        for (const page of pages) {
            const url = `${baseUrl}${page.url_slug}`;
            const lastmod = page.updated_at;
            const changefreq = this.getChangeFreq(page.page_type);
            const priority = this.getPriority(page.page_type);

            xml += this.createUrlEntry(url, lastmod, changefreq, priority);
        }

        xml += '</urlset>';

        return xml;
    }

    /**
     * Generate sitemap index (for multiple sitemaps)
     * @param {string} baseUrl - Base URL of the website
     * @returns {string} XML sitemap index string
     */
    async generateSitemapIndex(baseUrl = 'https://asacademy.com') {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Add individual sitemaps
        const categories = ['msbte', 'bca', 'dbatu'];

        for (const category of categories) {
            xml += `  <sitemap>\n`;
            xml += `    <loc>${baseUrl}/sitemap-${category}.xml</loc>\n`;
            xml += `    <lastmod>${new Date().toISOString()}</lastmod>\n`;
            xml += `  </sitemap>\n`;
        }

        xml += '</sitemapindex>';

        return xml;
    }

    /**
     * Generate category-specific sitemap
     * @param {string} categoryName - Category name (msbte, bca, dbatu)
     * @param {string} baseUrl - Base URL of the website
     * @returns {string} XML sitemap string
     */
    async generateCategorySitemap(categoryName, baseUrl = 'https://asacademy.com') {
        const pages = await seoService.getPagesByCategory(categoryName, null, 1000);

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Add category hub page
        xml += this.createUrlEntry(
            `${baseUrl}/${categoryName}`,
            new Date().toISOString(),
            'weekly',
            '0.9'
        );

        // Add category pages
        for (const page of pages) {
            const url = `${baseUrl}${page.url_slug}`;
            const lastmod = page.updated_at;
            const changefreq = this.getChangeFreq(page.page_type);
            const priority = this.getPriority(page.page_type);

            xml += this.createUrlEntry(url, lastmod, changefreq, priority);
        }

        xml += '</urlset>';

        return xml;
    }

    /**
     * Create a single URL entry for sitemap
     * @private
     */
    createUrlEntry(url, lastmod, changefreq, priority) {
        let entry = '  <url>\n';
        entry += `    <loc>${this.escapeXml(url)}</loc>\n`;
        entry += `    <lastmod>${lastmod.split('T')[0]}</lastmod>\n`;
        entry += `    <changefreq>${changefreq}</changefreq>\n`;
        entry += `    <priority>${priority}</priority>\n`;
        entry += '  </url>\n';
        return entry;
    }

    /**
     * Get change frequency based on page type
     * @private
     */
    getChangeFreq(pageType) {
        const frequencies = {
            'hub': 'weekly',
            'notes': 'monthly',
            'pyq': 'monthly',
            'practical': 'monthly',
            'project': 'monthly',
            'career': 'monthly',
            'exam-tips': 'monthly'
        };

        return frequencies[pageType] || 'monthly';
    }

    /**
     * Get priority based on page type
     * @private
     */
    getPriority(pageType) {
        const priorities = {
            'hub': '0.9',
            'notes': '0.8',
            'pyq': '0.8',
            'practical': '0.7',
            'project': '0.7',
            'career': '0.7',
            'exam-tips': '0.8'
        };

        return priorities[pageType] || '0.6';
    }

    /**
     * Escape XML special characters
     * @private
     */
    escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

export default new SitemapGenerator();
