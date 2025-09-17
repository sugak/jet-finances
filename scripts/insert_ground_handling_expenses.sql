-- SQL Script for inserting Ground Handling expenses into Jet Finances database
-- Run this script in your Supabase database

-- Step 1: Add Ground handling expense type if it doesn't exist
INSERT INTO expense_types (name, description) VALUES
('Ground handling', 'Ground handling services including arrival and departure services')
ON CONFLICT (name) DO NOTHING;

-- Step 2: Add arrival and departure subtypes for Ground handling
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, 'arrival', 'Arrival ground handling services'
FROM expense_types et WHERE et.name = 'Ground handling'
ON CONFLICT (expense_type_id, name) DO NOTHING;

INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, 'departure', 'Departure ground handling services'
FROM expense_types et WHERE et.name = 'Ground handling'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Step 3: Create a temporary table to store the expense data
CREATE TEMP TABLE temp_expenses (
    exp_place VARCHAR(10),
    exp_currency VARCHAR(3),
    exp_amount DECIMAL(10,2),
    exp_comments TEXT,
    expense_date DATE,
    aircraft VARCHAR(10),
    route_info TEXT
);

-- Step 4: Insert the expense data into temporary table
INSERT INTO temp_expenses (exp_place, exp_currency, exp_amount, exp_comments, expense_date, aircraft, route_info) VALUES
('OJAM', 'USD', 4200.00, 'AUTOSCAN: Handling-25 JUL24, A6-RTS, OJAM', '2024-07-25', 'A6-RTS', 'OJAM'),
('HEAL', 'USD', 2714.00, 'AUTOSCAN: Handling-19 Jun24, A6-RTS, HEAL-OMDW', '2024-06-19', 'A6-RTS', 'HEAL-OMDW'),
('OMDW', 'USD', 200.00, 'AUTOSCAN: Landing Permit-17-19 JUL24, A6RTS, OMDW', '2024-07-17', 'A6-RTS', 'OMDW'),
('OMDW', 'AED', 8605.39, 'AUTOSCAN: A6-RTS T#2407-08 Handling', '2024-07-08', 'A6-RTS', 'OMDW'),
('OMDW', 'AED', 9289.03, 'AUTOSCAN: A6-RTS T#2407-08 Handling', '2024-07-08', 'A6-RTS', 'OMDW'),
('LTBA', 'USD', 2318.91, 'AUTOSCAN: Handling-16 Aug24, A6-RTS, LTBA-OMDW', '2024-08-16', 'A6-RTS', 'LTBA-OMDW'),
('LTFE', 'EUR', 3520.00, 'AUTOSCAN: HANDLING-4 AUG24, A6-RTS, LTFE, OMDW', '2024-08-04', 'A6-RTS', 'LTFE-OMDW'),
('LTBA', 'EUR', 140.00, 'AUTOSCAN: Arrival-Departure,14 AUG24, A6-RTS, LTBA, OMDW-OMDW', '2024-08-14', 'A6-RTS', 'LTBA-OMDW'),
('LGKL', 'EUR', 2530.00, 'AUTOSCAN: HANDLING-24-25 JUL24, A6-RTS, LTBS, LGKL-OJAM', '2024-07-24', 'A6-RTS', 'LGKL-OJAM'),
('LTFE', 'EUR', 140.00, 'AUTOSCAN: Arrival-Departure,4 AUG24, A6-RTS, LTFE, OMDW-OMDW', '2024-08-04', 'A6-RTS', 'LTFE-OMDW'),
('LTBA', 'EUR', 140.00, 'AUTOSCAN: Arrival-Departure,12 AUG24, A6-RTS, LTBA, OMDB-OMDW', '2024-08-12', 'A6-RTS', 'LTBA-OMDW'),
('LTBA', 'EUR', 1705.00, 'AUTOSCAN: HANDLING,14 AUG24, A6-RTS, LTBA, OMDW-OMDW', '2024-08-14', 'A6-RTS', 'LTBA-OMDW'),
('LTBA', 'EUR', 140.00, 'AUTOSCAN: Arrival-Departure,16 AUG24, A6-RTS, LTBA, OMDW-OMDB', '2024-08-16', 'A6-RTS', 'LTBA-OMDB'),
('LTBA', 'EUR', 2350.00, 'AUTOSCAN: HANDLING,16 AUG24, A6-RTS, LTBA, OMDW-OMDB', '2024-08-16', 'A6-RTS', 'LTBA-OMDB');

-- Step 5: Insert expenses with arrival and departure subtypes
-- For each expense, create two records: one for arrival and one for departure
-- Each record gets half of the original amount

-- Insert arrival expenses
INSERT INTO expenses (
    exp_type,
    exp_subtype,
    exp_place,
    exp_currency,
    exp_amount,
    exp_comments,
    exp_flight,
    created_at,
    updated_at
)
SELECT 
    'Ground handling' as exp_type,
    'arrival' as exp_subtype,
    te.exp_place,
    te.exp_currency,
    ROUND(te.exp_amount / 2, 2) as exp_amount,
    CONCAT(te.exp_comments, ' - Arrival') as exp_comments,
    f.id as exp_flight,
    NOW() as created_at,
    NOW() as updated_at
FROM temp_expenses te
LEFT JOIN flights f ON (
    (f.flt_dep = te.exp_place OR f.flt_arr = te.exp_place) 
    AND f.flt_date = te.expense_date
)
WHERE te.exp_comments LIKE '%Handling%' OR te.exp_comments LIKE '%Arrival-Departure%';

-- Insert departure expenses
INSERT INTO expenses (
    exp_type,
    exp_subtype,
    exp_place,
    exp_currency,
    exp_amount,
    exp_comments,
    exp_flight,
    created_at,
    updated_at
)
SELECT 
    'Ground handling' as exp_type,
    'departure' as exp_subtype,
    te.exp_place,
    te.exp_currency,
    ROUND(te.exp_amount / 2, 2) as exp_amount,
    CONCAT(te.exp_comments, ' - Departure') as exp_comments,
    f.id as exp_flight,
    NOW() as created_at,
    NOW() as updated_at
FROM temp_expenses te
LEFT JOIN flights f ON (
    (f.flt_dep = te.exp_place OR f.flt_arr = te.exp_place) 
    AND f.flt_date = te.expense_date
)
WHERE te.exp_comments LIKE '%Handling%' OR te.exp_comments LIKE '%Arrival-Departure%';

-- Step 6: Insert Landing Permit expenses (these don't need to be split)
INSERT INTO expenses (
    exp_type,
    exp_subtype,
    exp_place,
    exp_currency,
    exp_amount,
    exp_comments,
    exp_flight,
    created_at,
    updated_at
)
SELECT 
    'Ground handling' as exp_type,
    'Landing Permit' as exp_subtype,
    te.exp_place,
    te.exp_currency,
    te.exp_amount,
    te.exp_comments,
    f.id as exp_flight,
    NOW() as created_at,
    NOW() as updated_at
FROM temp_expenses te
LEFT JOIN flights f ON (
    (f.flt_dep = te.exp_place OR f.flt_arr = te.exp_place) 
    AND f.flt_date = te.expense_date
)
WHERE te.exp_comments LIKE '%Landing Permit%';

-- Step 7: Add Landing Permit subtype if it doesn't exist
INSERT INTO expense_subtypes (expense_type_id, name, description) 
SELECT et.id, 'Landing Permit', 'Landing permit fees'
FROM expense_types et WHERE et.name = 'Ground handling'
ON CONFLICT (expense_type_id, name) DO NOTHING;

-- Step 8: Clean up temporary table
DROP TABLE temp_expenses;

-- Step 9: Show summary of inserted data
SELECT 
    exp_type,
    exp_subtype,
    exp_currency,
    COUNT(*) as record_count,
    SUM(exp_amount) as total_amount
FROM expenses 
WHERE exp_type = 'Ground handling'
GROUP BY exp_type, exp_subtype, exp_currency
ORDER BY exp_subtype, exp_currency;

-- Step 10: Show expenses with flight information
SELECT 
    e.exp_place,
    e.exp_subtype,
    e.exp_currency,
    e.exp_amount,
    e.exp_comments,
    f.flt_number,
    f.flt_date,
    f.flt_dep,
    f.flt_arr
FROM expenses e
LEFT JOIN flights f ON e.exp_flight = f.id
WHERE e.exp_type = 'Ground handling'
ORDER BY e.exp_place, e.exp_subtype;
