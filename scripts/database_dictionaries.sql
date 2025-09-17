-- SQL Script for creating dictionary tables for Jet Finances
-- Run this script in your Supabase database

-- Table for expense types (main categories)
CREATE TABLE IF NOT EXISTS expense_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for expense subtypes (linked to expense types)
CREATE TABLE IF NOT EXISTS expense_subtypes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_type_id UUID NOT NULL REFERENCES expense_types(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(expense_type_id, name)
);

-- Table for invoice types
CREATE TABLE IF NOT EXISTS invoice_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial expense types
INSERT INTO expense_types (name, description) VALUES
('Flight planning', 'Flight planning and navigation services'),
('Subscriptions', 'Software and service subscriptions'),
('Maintenance', 'Aircraft maintenance and repairs'),
('Crew', 'Crew-related expenses and training'),
('CAMO and Management', 'CAMO services and management'),
('Insurance', 'Insurance and risk management')
ON CONFLICT (name) DO NOTHING;

-- Insert initial expense subtypes
-- Flight planning subtypes
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, 'Flight planning', 'General flight planning services'
FROM expense_types et WHERE et.name = 'Flight planning'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Subscriptions subtypes
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, subtype_name, 'Subscription service'
FROM expense_types et,
     (VALUES ('GURU2'), ('PPS8'), ('Leon'), ('Avinode')) AS subtypes(subtype_name)
WHERE et.name = 'Subscriptions'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Maintenance subtypes
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, subtype_name, 'Maintenance service'
FROM expense_types et,
     (VALUES ('Maintenance'), ('Ramp parking')) AS subtypes(subtype_name)
WHERE et.name = 'Maintenance'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Crew subtypes
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, subtype_name, 'Crew service'
FROM expense_types et,
     (VALUES ('Training'), ('Documents')) AS subtypes(subtype_name)
WHERE et.name = 'Crew'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- CAMO and Management subtypes
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, subtype_name, 'CAMO service'
FROM expense_types et,
     (VALUES ('CAMO'), ('ARC Inspection')) AS subtypes(subtype_name)
WHERE et.name = 'CAMO and Management'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Insurance subtypes
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, 'Insurance', 'Insurance services'
FROM expense_types et WHERE et.name = 'Insurance'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Insert initial invoice types (you can customize these)
INSERT INTO invoice_types (name, description) VALUES
('Monthly', 'Monthly recurring invoice'),
('Quarterly', 'Quarterly recurring invoice'),
('Annual', 'Annual recurring invoice'),
('One-time', 'One-time service invoice'),
('Maintenance', 'Maintenance and repair invoice'),
('Fuel', 'Fuel and refueling invoice'),
('Crew', 'Crew-related services invoice'),
('Insurance', 'Insurance premium invoice')
ON CONFLICT (name) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_expense_subtypes_type_id ON expense_subtypes(expense_type_id);
CREATE INDEX IF NOT EXISTS idx_expense_types_name ON expense_types(name);
CREATE INDEX IF NOT EXISTS idx_invoice_types_name ON invoice_types(name);

-- Add updated_at trigger for expense_types
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_expense_types_updated_at 
    BEFORE UPDATE ON expense_types 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expense_subtypes_updated_at 
    BEFORE UPDATE ON expense_subtypes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoice_types_updated_at 
    BEFORE UPDATE ON invoice_types 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Table for activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'system',
    action VARCHAR(20) NOT NULL, -- CREATE, UPDATE, DELETE
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for activity logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_table_name ON activity_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
