import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import auditService from './audit.service.js';
import courseService from './course.service.js';

class CourseRequestService {
    // Create new course request (teacher only)
    async createRequest(teacherId, data) {
        const { title, description, price, validity_days, thumbnail_url, category, level } = data;

        console.log('📝 [SERVICE] Creating course request:', { teacherId, title, price, validity_days });

        // Validate required fields
        if (!title || !price || !validity_days) {
            console.log('❌ [SERVICE] Validation failed - missing required fields');
            throw new AppError('Title, price, and validity days are required', 400);
        }

        const insertData = {
            teacher_id: teacherId,
            title,
            description,
            price,
            validity_days,
            thumbnail_url,
            category,
            level,
            status: 'pending'
        };

        console.log('💾 [SERVICE] Inserting into database:', insertData);

        // Create request
        const { data: request, error } = await supabase
            .from('course_requests')
            .insert(insertData)
            .select(`
                *,
                users:teacher_id (
                    id,
                    name,
                    email
                )
            `)
            .single();

        if (error) {
            console.error('❌ [SERVICE] Database insert error:', error);
            console.error('❌ [SERVICE] Error details:', JSON.stringify(error, null, 2));
            throw new AppError('Failed to create course request: ' + error.message, 500);
        }

        if (!request) {
            console.error('❌ [SERVICE] No request returned from database');
            throw new AppError('Failed to create course request - no data returned', 500);
        }

        console.log('✅ [SERVICE] Course request created successfully:', { id: request.id, title: request.title, status: request.status });

        // Log action
        await auditService.log(
            teacherId,
            'COURSE_REQUEST_CREATED',
            `Created course request: ${title}`
        );

        return request;
    }

    // Get all course requests (admin only)
    async getAllRequests(filters = {}) {
        console.log('🔍 [DEBUG] Admin fetching course requests with filters:', filters);

        let query = supabase
            .from('course_requests')
            .select(`
                *,
                users:teacher_id (
                    id,
                    name,
                    email
                ),
                approved_by_user:approved_by (
                    id,
                    name
                )
            `)
            .order('created_at', { ascending: false });

        // Filter by status
        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        // Filter by teacher
        if (filters.teacherId) {
            query = query.eq('teacher_id', filters.teacherId);
        }

        const { data: requests, error } = await query;

        if (error) {
            console.error('❌ [DEBUG] Fetch requests error:', error);
            throw new AppError('Failed to fetch course requests', 500);
        }

        console.log('✅ [DEBUG] Fetched course requests:', { count: requests?.length || 0, statuses: requests?.map(r => r.status) });

        return requests || [];
    }

    // Get teacher's own requests
    async getMyRequests(teacherId) {
        const { data: requests, error } = await supabase
            .from('course_requests')
            .select(`
                *,
                approved_by_user:approved_by (
                    id,
                    name
                )
            `)
            .eq('teacher_id', teacherId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch your course requests', 500);
        }

        return requests || [];
    }

    // Approve request and create course
    async approveRequest(requestId, adminId) {
        // Get request details
        const { data: request, error: fetchError } = await supabase
            .from('course_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (fetchError || !request) {
            throw new AppError('Course request not found', 404);
        }

        if (request.status !== 'pending') {
            throw new AppError('Only pending requests can be approved', 400);
        }

        // Create the course
        const courseData = {
            title: request.title,
            description: request.description,
            price: request.price,
            validity_days: request.validity_days,
            thumbnail_url: request.thumbnail_url,
            teacher_id: request.teacher_id,
            status: 'active'
        };

        const course = await courseService.createCourse(courseData, adminId);

        // Update request status
        const { error: updateError } = await supabase
            .from('course_requests')
            .update({
                status: 'approved',
                approved_by: adminId,
                updated_at: new Date().toISOString()
            })
            .eq('id', requestId);

        if (updateError) {
            console.error('Failed to update request status:', updateError);
        }

        // Log action
        await auditService.log(
            adminId,
            'COURSE_REQUEST_APPROVED',
            `Approved course request: ${request.title} (Created course ID: ${course.id})`
        );

        return {
            success: true,
            message: 'Course request approved and course created',
            course,
            request
        };
    }

    // Reject request
    async rejectRequest(requestId, adminId, adminNotes) {
        // Get request details
        const { data: request, error: fetchError } = await supabase
            .from('course_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (fetchError || !request) {
            throw new AppError('Course request not found', 404);
        }

        if (request.status !== 'pending') {
            throw new AppError('Only pending requests can be rejected', 400);
        }

        // Update request status
        const { error: updateError } = await supabase
            .from('course_requests')
            .update({
                status: 'rejected',
                admin_notes: adminNotes,
                approved_by: adminId,
                updated_at: new Date().toISOString()
            })
            .eq('id', requestId);

        if (updateError) {
            throw new AppError('Failed to reject course request', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'COURSE_REQUEST_REJECTED',
            `Rejected course request: ${request.title}`
        );

        return {
            success: true,
            message: 'Course request rejected',
            request
        };
    }

    // Update request (admin can edit before approval)
    async updateRequest(requestId, updateData, adminId) {
        const allowedFields = ['title', 'description', 'price', 'validity_days', 'thumbnail_url', 'category', 'level'];
        const updates = {};

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                updates[field] = updateData[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            throw new AppError('No valid fields to update', 400);
        }

        updates.updated_at = new Date().toISOString();

        const { data: request, error } = await supabase
            .from('course_requests')
            .update(updates)
            .eq('id', requestId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to update course request', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'COURSE_REQUEST_UPDATED',
            `Updated course request: ${request.title}`
        );

        return request;
    }

    // Delete request
    async deleteRequest(requestId, userId) {
        const { error } = await supabase
            .from('course_requests')
            .delete()
            .eq('id', requestId);

        if (error) {
            throw new AppError('Failed to delete course request', 500);
        }

        // Log action
        await auditService.log(
            userId,
            'COURSE_REQUEST_DELETED',
            `Deleted course request ID: ${requestId}`
        );

        return { success: true, message: 'Course request deleted successfully' };
    }
}

export default new CourseRequestService();
