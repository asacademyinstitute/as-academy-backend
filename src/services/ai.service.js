import axios from 'axios';
import { config } from '../config/config.js';
import { AppError } from '../middlewares/error.middleware.js';

class AIService {
    // Solve student doubt
    async solveDoubt(question, context = '') {
        if (!config.ai.apiKey) {
            throw new AppError('AI service is not configured', 503);
        }

        try {
            const prompt = context
                ? `Context: ${context}\n\nStudent Question: ${question}\n\nProvide a clear and helpful answer to the student's question.`
                : `Student Question: ${question}\n\nProvide a clear and helpful answer to the student's question.`;

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: config.ai.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful educational assistant for AS Academy. Provide clear, accurate, and student-friendly explanations.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: 500,
                    temperature: 0.7
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.ai.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const answer = response.data.choices[0].message.content;

            return {
                question,
                answer,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('AI service error:', error.response?.data || error.message);
            throw new AppError('Failed to get AI response', 500);
        }
    }

    // Summarize content
    async summarizeContent(content) {
        if (!config.ai.apiKey) {
            throw new AppError('AI service is not configured', 503);
        }

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: config.ai.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful assistant that creates concise summaries of educational content.'
                        },
                        {
                            role: 'user',
                            content: `Please provide a concise summary of the following content:\n\n${content}`
                        }
                    ],
                    max_tokens: 300,
                    temperature: 0.5
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.ai.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const summary = response.data.choices[0].message.content;

            return {
                originalLength: content.length,
                summary,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('AI service error:', error.response?.data || error.message);
            throw new AppError('Failed to generate summary', 500);
        }
    }

    // Generate study tips
    async getStudyTips(topic) {
        if (!config.ai.apiKey) {
            throw new AppError('AI service is not configured', 503);
        }

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: config.ai.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful study advisor providing practical study tips and techniques.'
                        },
                        {
                            role: 'user',
                            content: `Provide 5 effective study tips for learning about: ${topic}`
                        }
                    ],
                    max_tokens: 400,
                    temperature: 0.7
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.ai.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const tips = response.data.choices[0].message.content;

            return {
                topic,
                tips,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('AI service error:', error.response?.data || error.message);
            throw new AppError('Failed to generate study tips', 500);
        }
    }
}

export default new AIService();
