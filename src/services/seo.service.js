import supabase from '../config/database.js';

class SeoService {
    // ==================== CATEGORIES ====================

    async getAllCategories() {
        const { data, error } = await supabase
            .from('seo_categories')
            .select('*')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        return data;
    }

    // ==================== SUBJECTS ====================

    async getSubjectsByCategory(categoryId, filters = {}) {
        let query = supabase
            .from('seo_subjects')
            .select('*')
            .eq('category_id', categoryId)
            .eq('is_active', true);

        if (filters.semester) {
            query = query.eq('semester', filters.semester);
        }
        if (filters.scheme) {
            query = query.eq('scheme', filters.scheme);
        }
        if (filters.branch) {
            query = query.eq('branch', filters.branch);
        }

        const { data, error } = await query.order('display_name');
        if (error) throw error;
        return data;
    }

    async createSubject(subjectData) {
        const { data, error } = await supabase
            .from('seo_subjects')
            .insert(subjectData)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    // ==================== PAGES ====================

    async getPageBySlug(slug) {
        const { data, error } = await supabase
            .from('seo_pages')
            .select(`
                *,
                category:seo_categories(*),
                subject:seo_subjects(*)
            `)
            .eq('url_slug', slug)
            .eq('is_published', true)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null; // Not found
            }
            throw error;
        }

        // Increment view count
        await this.incrementViewCount(data.id);

        return data;
    }

    async getPagesByCategory(categoryName, pageType = null, limit = 50) {
        // Get category first
        const { data: category } = await supabase
            .from('seo_categories')
            .select('id')
            .eq('name', categoryName)
            .single();

        if (!category) return [];

        let query = supabase
            .from('seo_pages')
            .select(`
                *,
                subject:seo_subjects(*)
            `)
            .eq('category_id', category.id)
            .eq('is_published', true);

        if (pageType) {
            query = query.eq('page_type', pageType);
        }

        const { data, error } = await query
            .order('view_count', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data;
    }

    async getRelatedPages(pageId, limit = 5) {
        const { data, error } = await supabase
            .from('seo_internal_links')
            .select(`
                to_page:seo_pages!to_page_id(
                    id,
                    title,
                    url_slug,
                    page_type,
                    thumbnail_url
                )
            `)
            .eq('from_page_id', pageId)
            .limit(limit);

        if (error) throw error;
        return data.map(item => item.to_page);
    }

    async createPage(pageData, userId) {
        const { data, error } = await supabase
            .from('seo_pages')
            .insert({
                ...pageData,
                created_by: userId,
                published_at: pageData.is_published ? new Date().toISOString() : null
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async updatePage(pageId, pageData) {
        const updateData = { ...pageData };

        // Set published_at if publishing for first time
        if (pageData.is_published && !pageData.published_at) {
            updateData.published_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('seo_pages')
            .update(updateData)
            .eq('id', pageId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async deletePage(pageId) {
        const { error } = await supabase
            .from('seo_pages')
            .delete()
            .eq('id', pageId);

        if (error) throw error;
    }

    // ==================== ANALYTICS ====================

    async incrementViewCount(pageId) {
        const { error } = await supabase.rpc('increment_view_count', {
            page_id: pageId
        });

        // If RPC doesn't exist, use update
        if (error) {
            await supabase
                .from('seo_pages')
                .update({ view_count: supabase.raw('view_count + 1') })
                .eq('id', pageId);
        }
    }

    async trackDownload(pageId, userId, ipAddress, userAgent) {
        // Insert download record
        const { error: insertError } = await supabase
            .from('seo_downloads')
            .insert({
                page_id: pageId,
                user_id: userId,
                ip_address: ipAddress,
                user_agent: userAgent
            });

        if (insertError) throw insertError;

        // Increment download count
        const { error: updateError } = await supabase
            .from('seo_pages')
            .update({ download_count: supabase.raw('download_count + 1') })
            .eq('id', pageId);

        if (updateError) throw updateError;
    }

    async getAnalytics(filters = {}) {
        let query = supabase
            .from('seo_pages')
            .select('id, title, url_slug, page_type, view_count, download_count, published_at')
            .eq('is_published', true);

        if (filters.category_id) {
            query = query.eq('category_id', filters.category_id);
        }
        if (filters.page_type) {
            query = query.eq('page_type', filters.page_type);
        }

        const { data, error } = await query
            .order('view_count', { ascending: false })
            .limit(filters.limit || 100);

        if (error) throw error;
        return data;
    }

    async getDownloadStats(pageId) {
        const { data, error } = await supabase
            .from('seo_downloads')
            .select('downloaded_at')
            .eq('page_id', pageId);

        if (error) throw error;

        // Group by date
        const stats = {};
        data.forEach(download => {
            const date = download.downloaded_at.split('T')[0];
            stats[date] = (stats[date] || 0) + 1;
        });

        return {
            total: data.length,
            by_date: stats
        };
    }

    // ==================== SEARCH ====================

    async searchPages(query, categoryName = null, limit = 20) {
        let dbQuery = supabase
            .from('seo_pages')
            .select(`
                *,
                category:seo_categories(*),
                subject:seo_subjects(*)
            `)
            .eq('is_published', true)
            .or(`title.ilike.%${query}%,content.ilike.%${query}%`);

        if (categoryName) {
            const { data: category } = await supabase
                .from('seo_categories')
                .select('id')
                .eq('name', categoryName)
                .single();

            if (category) {
                dbQuery = dbQuery.eq('category_id', category.id);
            }
        }

        const { data, error } = await dbQuery
            .order('view_count', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data;
    }

    // ==================== SITEMAP ====================

    async getAllPublishedPages() {
        const { data, error } = await supabase
            .from('seo_pages')
            .select('url_slug, updated_at, page_type')
            .eq('is_published', true)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return data;
    }

    // ==================== INTERNAL LINKING ====================

    async addInternalLink(fromPageId, toPageId, linkText, linkType = 'related') {
        const { data, error } = await supabase
            .from('seo_internal_links')
            .insert({
                from_page_id: fromPageId,
                to_page_id: toPageId,
                link_text: linkText,
                link_type: linkType
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation
                return null; // Link already exists
            }
            throw error;
        }
        return data;
    }

    async removeInternalLink(fromPageId, toPageId) {
        const { error } = await supabase
            .from('seo_internal_links')
            .delete()
            .eq('from_page_id', fromPageId)
            .eq('to_page_id', toPageId);

        if (error) throw error;
    }

    // ==================== KEYWORDS ====================

    async addKeyword(pageId, keyword, searchVolume = null) {
        const { data, error } = await supabase
            .from('seo_keywords')
            .insert({
                page_id: pageId,
                keyword: keyword,
                search_volume: searchVolume
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return null; // Keyword already exists
            }
            throw error;
        }
        return data;
    }

    async updateKeywordRank(keywordId, currentRank) {
        const { data, error } = await supabase
            .from('seo_keywords')
            .update({
                current_rank: currentRank,
                last_checked: new Date().toISOString()
            })
            .eq('id', keywordId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async getKeywordsByPage(pageId) {
        const { data, error } = await supabase
            .from('seo_keywords')
            .select('*')
            .eq('page_id', pageId)
            .order('current_rank');

        if (error) throw error;
        return data;
    }
}

export default new SeoService();
