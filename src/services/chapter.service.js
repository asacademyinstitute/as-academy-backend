import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class ChapterService {
    // Get chapters by course
    async getChaptersByCourse(courseId) {
        const { data: chapters, error } = await supabase
            .from('chapters')
            .select(`
        *,
        lectures (
          id,
          title,
          type,
          file_url,
          duration,
          lecture_order
        )
      `)
            .eq('course_id', courseId)
            .order('chapter_order', { ascending: true });

        if (error) {
            throw new AppError('Failed to fetch chapters', 500);
        }

        return chapters;
    }

    // Get chapter by ID
    async getChapterById(chapterId) {
        const { data: chapter, error } = await supabase
            .from('chapters')
            .select(`
        *,
        lectures (*)
      `)
            .eq('id', chapterId)
            .single();

        if (error || !chapter) {
            throw new AppError('Chapter not found', 404);
        }

        return chapter;
    }

    // Create chapter
    async createChapter(chapterData) {
        const { course_id, title, chapter_order } = chapterData;

        const { data: chapter, error } = await supabase
            .from('chapters')
            .insert({
                course_id,
                title,
                chapter_order
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new AppError('Chapter order already exists for this course', 400);
            }
            throw new AppError('Failed to create chapter', 500);
        }

        return chapter;
    }

    // Update chapter
    async updateChapter(chapterId, updateData) {
        const allowedFields = ['title', 'chapter_order'];
        const updates = {};

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                updates[field] = updateData[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            throw new AppError('No valid fields to update', 400);
        }

        const { data: chapter, error } = await supabase
            .from('chapters')
            .update(updates)
            .eq('id', chapterId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to update chapter', 500);
        }

        return chapter;
    }

    // Delete chapter
    async deleteChapter(chapterId) {
        const { error } = await supabase
            .from('chapters')
            .delete()
            .eq('id', chapterId);

        if (error) {
            throw new AppError('Failed to delete chapter', 500);
        }

        return { success: true, message: 'Chapter deleted successfully' };
    }

    // Reorder chapters
    async reorderChapters(courseId, chapterOrders) {
        // chapterOrders is an array of { id, chapter_order }
        try {
            for (const { id, chapter_order } of chapterOrders) {
                await supabase
                    .from('chapters')
                    .update({ chapter_order })
                    .eq('id', id)
                    .eq('course_id', courseId);
            }

            return { success: true, message: 'Chapters reordered successfully' };
        } catch (error) {
            throw new AppError('Failed to reorder chapters', 500);
        }
    }
}

export default new ChapterService();
