-- Исправление RLS для таблицы activity_logs
-- Выполните этот скрипт в Supabase SQL Editor

-- 1. Включить RLS для таблицы activity_logs
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- 2. Удаляем существующие политики (если есть)
DROP POLICY IF EXISTS "Superadmin can read activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "System can insert activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "Superadmin can update activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "Superadmin can delete activity_logs" ON activity_logs;

-- 3. Политика для чтения логов (только суперадмин)
CREATE POLICY "Superadmin can read activity_logs" ON activity_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- 4. Политика для записи логов (система может записывать)
CREATE POLICY "System can insert activity_logs" ON activity_logs
  FOR INSERT WITH CHECK (true);

-- 5. Политика для обновления логов (только суперадмин)
CREATE POLICY "Superadmin can update activity_logs" ON activity_logs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- 6. Политика для удаления логов (только суперадмин)
CREATE POLICY "Superadmin can delete activity_logs" ON activity_logs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- 6. Проверим, что RLS включен
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'activity_logs';
