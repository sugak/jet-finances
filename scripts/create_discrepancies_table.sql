-- Create discrepancies table
CREATE TABLE IF NOT EXISTS discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Created' CHECK (status IN ('Created', 'Raised', 'Resolved', 'Declined', 'Closed')),
  solution TEXT,
  claimed_amount NUMERIC(15, 2),
  claimed_currency TEXT CHECK (claimed_currency IN ('AED', 'USD', 'EUR')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on invoice_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_discrepancies_invoice_id ON discrepancies(invoice_id);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_discrepancies_status ON discrepancies(status);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_discrepancies_created_at ON discrepancies(created_at DESC);

-- Add comment to table
COMMENT ON TABLE discrepancies IS 'Stores information about all claimed discrepancies or objections in issued invoices';

-- Enable Row Level Security (same as flights table)
ALTER TABLE discrepancies ENABLE ROW LEVEL SECURITY;

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
CREATE POLICY "Service role can manage discrepancies"
  ON discrepancies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

