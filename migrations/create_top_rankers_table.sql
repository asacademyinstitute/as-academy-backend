-- Create top_rankers table
CREATE TABLE IF NOT EXISTS top_rankers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    photo_url TEXT NOT NULL,
    percentage DECIMAL(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    rank INTEGER NOT NULL CHECK (rank > 0),
    exam_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on rank for faster sorting
CREATE INDEX IF NOT EXISTS idx_top_rankers_rank ON top_rankers(rank);

-- Create index on is_active for filtering active rankers
CREATE INDEX IF NOT EXISTS idx_top_rankers_active ON top_rankers(is_active);

-- Add comment to table
COMMENT ON TABLE top_rankers IS 'Stores top performing students to display on homepage';

-- Add comments to columns
COMMENT ON COLUMN top_rankers.name IS 'Student full name';
COMMENT ON COLUMN top_rankers.photo_url IS 'B2 storage key for student photo';
COMMENT ON COLUMN top_rankers.percentage IS 'Exam percentage (0-100)';
COMMENT ON COLUMN top_rankers.rank IS 'Student rank/position';
COMMENT ON COLUMN top_rankers.exam_name IS 'Optional exam/test name';
COMMENT ON COLUMN top_rankers.is_active IS 'Whether to display on homepage';
