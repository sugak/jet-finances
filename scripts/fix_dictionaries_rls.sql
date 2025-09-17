-- RLS политики для справочников
-- Выполните этот скрипт в Supabase SQL Editor

-- 1. Включить RLS для справочников
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_subtypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_types ENABLE ROW LEVEL SECURITY;

-- 2. Политики для expense_types
-- Удаляем существующие политики (если есть)
DROP POLICY IF EXISTS "Authenticated users can read expense_types" ON expense_types;
DROP POLICY IF EXISTS "Superadmin can manage expense_types" ON expense_types;

-- Чтение для всех авторизованных пользователей
CREATE POLICY "Authenticated users can read expense_types" ON expense_types
  FOR SELECT USING (auth.role() = 'authenticated');

-- Управление только для суперадмина
CREATE POLICY "Superadmin can manage expense_types" ON expense_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- 3. Политики для expense_subtypes
-- Удаляем существующие политики (если есть)
DROP POLICY IF EXISTS "Authenticated users can read expense_subtypes" ON expense_subtypes;
DROP POLICY IF EXISTS "Superadmin can manage expense_subtypes" ON expense_subtypes;

-- Чтение для всех авторизованных пользователей
CREATE POLICY "Authenticated users can read expense_subtypes" ON expense_subtypes
  FOR SELECT USING (auth.role() = 'authenticated');

-- Управление только для суперадмина
CREATE POLICY "Superadmin can manage expense_subtypes" ON expense_subtypes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- 4. Политики для invoice_types
-- Удаляем существующие политики (если есть)
DROP POLICY IF EXISTS "Authenticated users can read invoice_types" ON invoice_types;
DROP POLICY IF EXISTS "Superadmin can manage invoice_types" ON invoice_types;

-- Чтение для всех авторизованных пользователей
CREATE POLICY "Authenticated users can read invoice_types" ON invoice_types
  FOR SELECT USING (auth.role() = 'authenticated');

-- Управление только для суперадмина
CREATE POLICY "Superadmin can manage invoice_types" ON invoice_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- 5. Проверим статус RLS для всех таблиц
SELECT 
  schemaname, 
  tablename, 
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename IN (
  'activity_logs', 
  'expense_types', 
  'expense_subtypes', 
  'invoice_types',
  'users',
  'flights',
  'expenses',
  'invoices'
)
ORDER BY tablename;
