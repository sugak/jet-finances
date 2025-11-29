-- Fix RLS policies for discrepancies table (same as flights table)
-- This script should be run if you're getting "row-level security policy" errors
-- 
-- Creates RLS policies matching the flights table structure:
-- 1. Authenticated users can read
-- 2. Superadmin can insert/update/delete

-- Enable RLS if not already enabled
ALTER TABLE discrepancies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Authenticated users can read discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Superadmin can insert discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Superadmin can update discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Superadmin can delete discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to read discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to insert discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to update discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to delete discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow service_role full access to discrepancies" ON discrepancies;

-- Policy: Allow authenticated users to read all discrepancies
CREATE POLICY "Authenticated users can read discrepancies"
  ON discrepancies
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow superadmin to insert discrepancies
CREATE POLICY "Superadmin can insert discrepancies"
  ON discrepancies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'superadmin'
    )
  );

-- Policy: Allow superadmin to update discrepancies
CREATE POLICY "Superadmin can update discrepancies"
  ON discrepancies
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'superadmin'
    )
  );

-- Policy: Allow superadmin to delete discrepancies
CREATE POLICY "Superadmin can delete discrepancies"
  ON discrepancies
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'superadmin'
    )
  );

-- Policy: Allow service_role to bypass RLS (for server-side operations)
-- This allows the backend server using SUPABASE_SERVICE_ROLE_KEY to work
DROP POLICY IF EXISTS "Service role can manage discrepancies" ON discrepancies;
CREATE POLICY "Service role can manage discrepancies"
  ON discrepancies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename = 'discrepancies'
ORDER BY policyname;

