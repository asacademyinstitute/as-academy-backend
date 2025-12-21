import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Create Supabase client with service role key for backend operations
export const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// Helper function to execute queries
export const query = async (sql, params = []) => {
    try {
        const { data, error } = await supabase.rpc('execute_sql', {
            query: sql,
            params: params
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

export default supabase;
