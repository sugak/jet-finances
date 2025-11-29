-- Fix RLS for discrepancies table - DISABLE RLS (same as flights and invoices)
-- This script should be run if you're getting "row-level security policy" errors
-- 
-- The simplest solution is to disable RLS for discrepancies table,
-- same as it's done for flights and invoices tables.
-- Server uses SUPABASE_SERVICE_ROLE_KEY which works without RLS.

-- Drop all existing policies first
DROP POLICY IF EXISTS "Allow authenticated users to read discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to insert discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to update discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow authenticated users to delete discrepancies" ON discrepancies;
DROP POLICY IF EXISTS "Allow service_role full access to discrepancies" ON discrepancies;

-- Disable RLS for discrepancies table (same approach as flights and invoices)
ALTER TABLE discrepancies DISABLE ROW LEVEL SECURITY;

-- Verify RLS is disabled
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE tablename = 'discrepancies';

