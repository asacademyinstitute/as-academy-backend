import { Router } from 'express';
import quizService from '../services/quiz.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isTeacherOrAdmin, isStudent } from '../middlewares/rbac.middleware.js';

const router = Router();

// Get quizzes by course
router.get('/course/:courseId', authenticate, asyncHandler(async (req, res) => {
    const quizzes = await quizService.getQuizzesByCourse(req.params.courseId);

    res.json({
        success: true,
        data: quizzes
    });
}));

// Get quiz by ID
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    // Teachers and admins can see answers, students cannot
    const includeAnswers = req.user.role !== 'student';

    const quiz = await quizService.getQuizById(req.params.id, includeAnswers);

    res.json({
        success: true,
        data: quiz
    });
}));

// Create quiz (teacher or admin)
router.post('/', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const quiz = await quizService.createQuiz(req.body);

    res.status(201).json({
        success: true,
        message: 'Quiz created successfully',
        data: quiz
    });
}));

// Submit quiz (student)
router.post('/:id/submit', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { answers } = req.body;

    const result = await quizService.submitQuiz(req.params.id, req.user.id, answers);

    res.json({
        success: true,
        message: 'Quiz submitted successfully',
        data: result
    });
}));

// Get student attempts
router.get('/student/:studentId/attempts', authenticate, asyncHandler(async (req, res) => {
    const { quizId } = req.query;

    const attempts = await quizService.getStudentAttempts(req.params.studentId, quizId);

    res.json({
        success: true,
        data: attempts
    });
}));

// Delete quiz (teacher or admin)
router.delete('/:id', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const result = await quizService.deleteQuiz(req.params.id);

    res.json({
        success: true,
        message: result.message
    });
}));

export default router;
