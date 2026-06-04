import { supabase } from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import streamingService from './streaming.service.js';

class TopRankerService {
    // Get all top rankers (admin)
    async getAllTopRankers() {
        const { data: rankers, error } = await supabase
            .from('top_rankers')
            .select('*')
            .order('rank', { ascending: true });

        if (error) {
            throw new AppError('Failed to fetch top rankers', 500);
        }

        // Generate signed URLs for all rankers photos if they exist
        const updatedRankers = await Promise.all((rankers || []).map(async (ranker) => {
            if (ranker.photo_url) {
                try {
                    const signedUrl = await streamingService.getSignedUrl(ranker.photo_url, 86400); // 24 hours validity
                    return { ...ranker, photo_url: signedUrl };
                } catch (err) {
                    console.error(`Failed to sign photo URL for ranker ${ranker.id}:`, err);
                }
            }
            return ranker;
        }));

        return updatedRankers;
    }

    // Get active top rankers (public)
    async getActiveTopRankers() {
        const { data: rankers, error } = await supabase
            .from('top_rankers')
            .select('*')
            .eq('is_active', true)
            .order('rank', { ascending: true });

        if (error) {
            throw new AppError('Failed to fetch active top rankers', 500);
        }

        // Generate signed URLs for all rankers photos if they exist
        const updatedRankers = await Promise.all((rankers || []).map(async (ranker) => {
            if (ranker.photo_url) {
                try {
                    const signedUrl = await streamingService.getSignedUrl(ranker.photo_url, 86400); // 24 hours validity
                    return { ...ranker, photo_url: signedUrl };
                } catch (err) {
                    console.error(`Failed to sign photo URL for active ranker ${ranker.id}:`, err);
                }
            }
            return ranker;
        }));

        return updatedRankers;
    }

    // Create new top ranker
    async createTopRanker(rankerData) {
        const { name, photo_url, percentage, rank, exam_name } = rankerData;

        // Validate percentage
        if (percentage < 0 || percentage > 100) {
            throw new AppError('Percentage must be between 0 and 100', 400);
        }

        const { data: ranker, error } = await supabase
            .from('top_rankers')
            .insert({
                name,
                photo_url,
                percentage,
                rank,
                exam_name: exam_name || null,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            console.error('Create top ranker error:', error);
            throw new AppError('Failed to create top ranker', 500);
        }

        return ranker;
    }

    // Update top ranker
    async updateTopRanker(id, rankerData) {
        const { name, photo_url, percentage, rank, exam_name } = rankerData;

        // Validate percentage if provided
        if (percentage !== undefined && (percentage < 0 || percentage > 100)) {
            throw new AppError('Percentage must be between 0 and 100', 400);
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (photo_url !== undefined) updateData.photo_url = photo_url;
        if (percentage !== undefined) updateData.percentage = percentage;
        if (rank !== undefined) updateData.rank = rank;
        if (exam_name !== undefined) updateData.exam_name = exam_name;
        updateData.updated_at = new Date().toISOString();

        const { data: ranker, error } = await supabase
            .from('top_rankers')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Update top ranker error:', error);
            throw new AppError('Failed to update top ranker', 500);
        }

        return ranker;
    }

    // Delete top ranker (with B2 photo deletion)
    async deleteTopRanker(id) {
        // Get ranker to find photo_url
        const { data: ranker } = await supabase
            .from('top_rankers')
            .select('photo_url')
            .eq('id', id)
            .single();

        // Delete photo from B2 storage if exists
        if (ranker && ranker.photo_url) {
            console.log('🗑️ Deleting ranker photo from B2:', ranker.photo_url);
            await streamingService.deleteFile(ranker.photo_url);
        }

        // Delete ranker from database
        const { error } = await supabase
            .from('top_rankers')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Delete top ranker error:', error);
            throw new AppError('Failed to delete top ranker', 500);
        }

        return { success: true, message: 'Top ranker and photo deleted successfully' };
    }

    // Toggle active status
    async toggleTopRanker(id) {
        // Get current status
        const { data: ranker } = await supabase
            .from('top_rankers')
            .select('is_active')
            .eq('id', id)
            .single();

        if (!ranker) {
            throw new AppError('Top ranker not found', 404);
        }

        // Toggle status
        const { data: updated, error } = await supabase
            .from('top_rankers')
            .update({
                is_active: !ranker.is_active,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Toggle top ranker error:', error);
            throw new AppError('Failed to toggle top ranker status', 500);
        }

        return updated;
    }

    // Get homepage visibility setting
    async getVisibilitySetting() {
        const { data, error } = await supabase
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'show_rankers_on_homepage')
            .single();

        if (error || !data) {
            return false; // Default to hidden
        }

        return data.setting_value === 'true';
    }

    // Set homepage visibility setting (admin only)
    async setVisibilitySetting(enabled, adminId) {
        const value = enabled ? 'true' : 'false';

        // First try to update, if no rows affected, insert
        const { data: existing } = await supabase
            .from('system_settings')
            .select('id')
            .eq('setting_key', 'show_rankers_on_homepage')
            .single();

        if (existing) {
            const { error } = await supabase
                .from('system_settings')
                .update({
                    setting_value: value,
                    updated_by: adminId,
                    updated_at: new Date().toISOString()
                })
                .eq('setting_key', 'show_rankers_on_homepage');

            if (error) {
                throw new AppError('Failed to update visibility setting', 500);
            }
        } else {
            const { error } = await supabase
                .from('system_settings')
                .insert({
                    setting_key: 'show_rankers_on_homepage',
                    setting_value: value,
                    description: 'Controls whether the Top Rankers section is displayed on the homepage',
                    updated_by: adminId
                });

            if (error) {
                throw new AppError('Failed to create visibility setting', 500);
            }
        }

        return {
            success: true,
            message: `Top Rankers ${enabled ? 'will be shown' : 'will be hidden'} on homepage`,
            enabled
        };
    }

}

export default new TopRankerService();
