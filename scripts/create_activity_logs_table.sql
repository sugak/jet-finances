-- Create activity_logs table for Jet Finances
-- Run this script in your Supabase database

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'system',
    action VARCHAR(20) NOT NULL, -- CREATE, UPDATE, DELETE
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    record_details TEXT, -- Additional details like flight number, invoice number, etc.
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_table_name ON activity_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_record_details ON activity_logs(record_details);

-- Insert a test log entry
INSERT INTO activity_logs (user_id, action, table_name, record_id, record_details, new_data) 
VALUES ('system', 'CREATE', 'test_table', gen_random_uuid(), 'Test record details', '{"test": "data"}'::jsonb);