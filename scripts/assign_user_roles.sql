-- SQL скрипт для назначения ролей пользователям
-- Выполните этот скрипт в Supabase SQL Editor

-- 1. Сначала убедимся, что таблица users существует
CREATE TABLE IF NOT EXISTS users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'reader')),
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Включение RLS для таблицы users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 3. Политики для таблицы users
DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- 4. Назначение ролей для ваших пользователей
-- Замените email адреса на ваши реальные

-- Назначить роль superadmin для m.a.sugak@gmail.com
INSERT INTO users (id, email, role, full_name) VALUES
  (
    (SELECT id FROM auth.users WHERE email = 'm.a.sugak@gmail.com'),
    'm.a.sugak@gmail.com',
    'superadmin',
    'Admin User'
  )
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  updated_at = NOW();

-- Назначить роль reader для rts@a6jrm.org
INSERT INTO users (id, email, role, full_name) VALUES
  (
    (SELECT id FROM auth.users WHERE email = 'rts@a6jrm.org'),
    'rts@a6jrm.org',
    'reader',
    'Regular User'
  )
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  updated_at = NOW();

-- 5. Проверим, что роли назначены
SELECT 
  u.email,
  u.role,
  u.full_name,
  u.created_at
FROM users u
WHERE u.email IN ('m.a.sugak@gmail.com', 'rts@a6jrm.org')
ORDER BY u.role DESC, u.email;
