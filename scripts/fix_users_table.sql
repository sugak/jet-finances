-- Исправление таблицы users
-- Выполните этот SQL в Supabase Dashboard → SQL Editor

-- 1. Убеждаемся, что таблица users существует
CREATE TABLE IF NOT EXISTS users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'reader')),
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Включаем RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 3. Создаем политики
DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- 4. Добавляем пользователей с правильными данными
INSERT INTO users (id, email, role, full_name) VALUES
  (
    'ffcca9f2-9813-48c2-9827-0d0659192c04', -- ID admin пользователя
    'admin@a6jrm.org',
    'superadmin',
    'Admin User'
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  updated_at = NOW();

INSERT INTO users (id, email, role, full_name) VALUES
  (
    'e69f7eb9-e5dd-4691-9f86-364c93f1ec1b', -- ID user пользователя
    'user@a6jrm.org',
    'reader',
    'Regular User'
  )
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  updated_at = NOW();

-- 5. Проверяем результат
SELECT 
  u.email,
  u.role,
  u.full_name,
  u.created_at
FROM users u
ORDER BY u.role DESC, u.email;
