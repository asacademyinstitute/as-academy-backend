import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import certificateService from './certificate.service.js';

class LectureService {
    // Get lectures by chapter
    async getLecturesByChapter(chapterId) {
        const { data: lectures, error } = await supabase
            .from('lectures')
            .select('*')
            .eq('chapter_id', chapterId)
            .order('lecture_order', { ascending: true });

        if (error) {
            throw new AppError('Failed to fetch lectures', 500);
        }

        return lectures;
    }

    // Get lecture by ID
    async getLectureById(lectureId) {
        const { data: lecture, error } = await supabase
            .from('lectures')
            .select(`
        *,
        chapters:chapter_id (
          id,
          title,
          course_id
        )
      `)
            .eq('id', lectureId)
            .single();

        if (error || !lecture) {
            throw new AppError('Lecture not found', 404);
        }

        return lecture;
    }

    // Create lecture
    async createLecture(lectureData) {
        const { chapter_id, title, type, file_url, duration, lecture_order } = lectureData;

        const { data: lecture, error } = await supabase
            .from('lectures')
            .insert({
                chapter_id,
                title,
                type,
                file_url,
                duration,
                lecture_order
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                throw new AppError('Lecture order already exists for this chapter', 400);
            }
            throw new AppError('Failed to create lecture', 500);
        }

        return lecture;
    }

    // Update lecture
    async updateLecture(lectureId, updateData) {
        const allowedFields = ['title', 'type', 'file_url', 'duration', 'lecture_order'];
        const updates = {};

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                updates[field] = updateData[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            throw new AppError('No valid fields to update', 400);
        }

        const { data: lecture, error } = await supabase
            .from('lectures')
            .update(updates)
            .eq('id', lectureId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to update lecture', 500);
        }

        return lecture;
    }

    // Delete lecture
    async deleteLecture(lectureId) {
        const { error } = await supabase
            .from('lectures')
            .delete()
            .eq('id', lectureId);

        if (error) {
            throw new AppError('Failed to delete lecture', 500);
        }

        return { success: true, message: 'Lecture deleted successfully' };
    }

    // Reorder lectures
    async reorderLectures(chapterId, lectureOrders) {
        try {
            for (const { id, lecture_order } of lectureOrders) {
                await supabase
                    .from('lectures')
                    .update({ lecture_order })
                    .eq('id', id)
                    .eq('chapter_id', chapterId);
            }

            return { success: true, message: 'Lectures reordered successfully' };
        } catch (error) {
            throw new AppError('Failed to reorder lectures', 500);
        }
    }

    // Get lecture progress for student
    async getLectureProgress(studentId, lectureId) {
        const { data: progress, error } = await supabase
            .from('lecture_progress')
            .select('*')
            .eq('student_id', studentId)
            .eq('lecture_id', lectureId)
            .single();

        if (error && error.code !== 'PGRST116') { // Not found is ok
            throw new AppError('Failed to fetch lecture progress', 500);
        }

        return progress || { completed: false, last_position: 0 };
    }

    // Update lecture progress
    async updateLectureProgress(studentId, lectureId, progressData) {
        const { completed, last_position } = progressData;

        const updateData = {
            student_id: studentId,
            lecture_id: lectureId,
            completed: completed || false,
            last_position: last_position || 0
        };

        if (completed) {
            updateData.completed_at = new Date().toISOString();
        }

        const { data: progress, error } = await supabase
            .from('lecture_progress')
            .upsert(updateData, {
                onConflict: 'student_id,lecture_id'
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to update lecture progress', 500);
        }

        // Check if all lectures in the course are completed
        if (completed) {
            try {
                await this.checkAndGenerateCertificate(studentId, lectureId);
            } catch (certError) {
                // Log error but don't fail the progress update
                console.error('Certificate generation error:', certError);
            }
        }

        return progress;
    }

    // Check if all course lectures are completed and generate certificate
    async checkAndGenerateCertificate(studentId, lectureId) {
        // Get the course ID for this lecture
        const lecture = await this.getLectureById(lectureId);
        const courseId = lecture.chapters.course_id;

        // Get all lectures for this course
        const { data: allLectures } = await supabase
            .from('lectures')
            .select('id')
            .eq('chapter_id', supabase.rpc('get_course_chapters', { p_course_id: courseId }));

        // Alternative: Get all lectures via chapters
        const { data: chapters } = await supabase
            .from('chapters')
            .select('id')
            .eq('course_id', courseId);

        if (!chapters || chapters.length === 0) {
            return;
        }

        const chapterIds = chapters.map(c => c.id);

        const { data: courseLectures } = await supabase
            .from('lectures')
            .select('id')
            .in('chapter_id', chapterIds);

        if (!courseLectures || courseLectures.length === 0) {
            return;
        }

        // Get student's completed lectures for this course
        const lectureIds = courseLectures.map(l => l.id);

        const { data: completedLectures } = await supabase
            .from('lecture_progress')
            .select('lecture_id')
            .eq('student_id', studentId)
            .in('lecture_id', lectureIds)
            .eq('completed', true);

        // Check if all lectures are completed
        if (completedLectures && completedLectures.length === courseLectures.length) {
            console.log(`🎓 All lectures completed for course ${courseId}. Generating certificate...`);

            // Check if certificate already exists
            const { data: existingCert } = await supabase
                .from('certificates')
                .select('id')
                .eq('student_id', studentId)
                .eq('course_id', courseId)
                .single();

            if (!existingCert) {
                // Generate certificate
                await certificateService.generateCertificate(studentId, courseId);
                console.log(`✅ Certificate generated for student ${studentId}, course ${courseId}`);
            }
        }
    }

    // Transfer lectures to another chapter
    async transferLectures(lectureIds, targetChapterId, adminId) {
        // Verify target chapter exists
        const { data: targetChapter, error: chapterError } = await supabase
            .from('chapters')
            .select('id, title, course_id')
            .eq('id', targetChapterId)
            .single();

        if (chapterError || !targetChapter) {
            throw new AppError('Target chapter not found', 404);
        }

        // Get max lecture_order in target chapter
        const { data: existingLectures } = await supabase
            .from('lectures')
            .select('lecture_order')
            .eq('chapter_id', targetChapterId)
            .order('lecture_order', { ascending: false })
            .limit(1);

        let nextOrder = existingLectures && existingLectures.length > 0
            ? existingLectures[0].lecture_order + 1
            : 1;

        // Transfer each lecture
        const transferred = [];
        for (const lectureId of lectureIds) {
            const { data: lecture, error } = await supabase
                .from('lectures')
                .update({
                    chapter_id: targetChapterId,
                    lecture_order: nextOrder++
                })
                .eq('id', lectureId)
                .select()
                .single();

            if (!error && lecture) {
                transferred.push(lecture);
            }
        }

        return {
            success: true,
            message: `${transferred.length} lecture(s) transferred successfully`,
            transferred_count: transferred.length,
            target_chapter: targetChapter
        };
    }
}

export default new LectureService();
