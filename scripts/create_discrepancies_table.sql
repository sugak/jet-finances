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

-- Note: RLS is disabled for this table, same as flights and invoices tables
-- Server uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS automatically
-- ALTER TABLE discrepancies ENABLE ROW LEVEL SECURITY;

