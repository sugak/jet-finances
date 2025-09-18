-- SQL скрипт для удаления прав со старых пользователей
-- Выполните этот скрипт в Supabase SQL Editor

-- 1. Удаляем старых пользователей из таблицы users (убираем роли)
DELETE FROM users 
WHERE email IN ('admin@a6jrm.org', 'user@a6jrm.org');

-- 2. Проверяем, что старые пользователи удалены
SELECT 
  u.email,
  u.role,
  u.full_name
FROM users u
WHERE u.email IN ('admin@a6jrm.org', 'user@a6jrm.org');

-- 3. Показываем текущих активных пользователей
SELECT 
  u.email,
  u.role,
  u.full_name,
  u.created_at
FROM users u
ORDER BY u.role DESC, u.email;

-- 4. Дополнительно: можно деактивировать старых пользователей в auth.users
-- (Это нужно делать через Supabase Dashboard или API)
-- UPDATE auth.users 
-- SET 
--   email_confirmed_at = NULL,
--   banned_until = NOW() + INTERVAL '100 years'
-- WHERE email IN ('admin@a6jrm.org', 'user@a6jrm.org');
