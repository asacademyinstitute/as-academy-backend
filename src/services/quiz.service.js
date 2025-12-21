import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class QuizService {
    // Create quiz
    async createQuiz(quizData) {
        const { course_id, title, description, total_marks, passing_marks, duration_minutes, questions } = quizData;

        // Create quiz
        const { data: quiz, error: quizError } = await supabase
            .from('quizzes')
            .insert({
                course_id,
                title,
                description,
                total_marks,
                passing_marks,
                duration_minutes
            })
            .select()
            .single();

        if (quizError) {
            throw new AppError('Failed to create quiz', 500);
        }

        // Add questions if provided
        if (questions && questions.length > 0) {
            const questionsData = questions.map((q, index) => ({
                quiz_id: quiz.id,
                question_text: q.question_text,
                option_a: q.option_a,
                option_b: q.option_b,
                option_c: q.option_c,
                option_d: q.option_d,
                correct_answer: q.correct_answer,
                marks: q.marks || 1,
                question_order: index + 1
            }));

            const { error: questionsError } = await supabase
                .from('quiz_questions')
                .insert(questionsData);

            if (questionsError) {
                throw new AppError('Failed to add quiz questions', 500);
            }
        }

        return quiz;
    }

    // Get quiz by ID
    async getQuizById(quizId, includeAnswers = false) {
        const { data: quiz, error } = await supabase
            .from('quizzes')
            .select('*')
            .eq('id', quizId)
            .single();

        if (error || !quiz) {
            throw new AppError('Quiz not found', 404);
        }

        // Get questions
        let selectFields = 'id, question_text, option_a, option_b, option_c, option_d, marks, question_order';
        if (includeAnswers) {
            selectFields += ', correct_answer';
        }

        const { data: questions } = await supabase
            .from('quiz_questions')
            .select(selectFields)
            .eq('quiz_id', quizId)
            .order('question_order', { ascending: true });

        quiz.questions = questions || [];

        return quiz;
    }

    // Get quizzes by course
    async getQuizzesByCourse(courseId) {
        const { data: quizzes, error } = await supabase
            .from('quizzes')
            .select('*')
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch quizzes', 500);
        }

        return quizzes;
    }

    // Submit quiz attempt
    async submitQuiz(quizId, studentId, answers) {
        // Get quiz with correct answers
        const quiz = await this.getQuizById(quizId, true);

        // Calculate score
        let score = 0;
        const results = [];

        for (const question of quiz.questions) {
            const studentAnswer = answers[question.id];
            const isCorrect = studentAnswer === question.correct_answer;

            if (isCorrect) {
                score += question.marks;
            }

            results.push({
                questionId: question.id,
                studentAnswer,
                correctAnswer: question.correct_answer,
                isCorrect,
                marks: isCorrect ? question.marks : 0
            });
        }

        const passed = score >= quiz.passing_marks;

        // Save attempt
        const { data: attempt, error } = await supabase
            .from('quiz_attempts')
            .insert({
                quiz_id: quizId,
                student_id: studentId,
                score,
                total_marks: quiz.total_marks,
                passed,
                submitted_at: new Date().toISOString(),
                answers: answers
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to save quiz attempt', 500);
        }

        return {
            attempt,
            score,
            totalMarks: quiz.total_marks,
            passed,
            percentage: Math.round((score / quiz.total_marks) * 100),
            results
        };
    }

    // Get student quiz attempts
    async getStudentAttempts(studentId, quizId = null) {
        let query = supabase
            .from('quiz_attempts')
            .select(`
        *,
        quizzes:quiz_id (
          title,
          total_marks,
          passing_marks
        )
      `)
            .eq('student_id', studentId)
            .order('started_at', { ascending: false });

        if (quizId) {
            query = query.eq('quiz_id', quizId);
        }

        const { data: attempts, error } = await query;

        if (error) {
            throw new AppError('Failed to fetch quiz attempts', 500);
        }

        return attempts;
    }

    // Delete quiz
    async deleteQuiz(quizId) {
        const { error } = await supabase
            .from('quizzes')
            .delete()
            .eq('id', quizId);

        if (error) {
            throw new AppError('Failed to delete quiz', 500);
        }

        return { success: true, message: 'Quiz deleted successfully' };
    }
}

export default new QuizService();
