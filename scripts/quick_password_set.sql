-- Быстрая установка паролей через SQL (требует выполнения скрипта JS после)
-- Этот SQL только подготавливает пользователей, пароли устанавливаются через JS

-- 1. Убеждаемся, что пользователи существуют в auth.users
-- (Это нужно делать через Supabase Dashboard или API)

-- 2. Обновляем роли в таблице users
INSERT INTO users (id, email, role, full_name) VALUES
  (
    (SELECT id FROM auth.users WHERE email = 'admin@a6jrm.org'),
    'admin@a6jrm.org',
    'superadmin',
    'Admin User'
  )
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  updated_at = NOW();

INSERT INTO users (id, email, role, full_name) VALUES
  (
    (SELECT id FROM auth.users WHERE email = 'user@a6jrm.org'),
    'user@a6jrm.org',
    'reader',
    'Regular User'
  )
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  updated_at = NOW();

-- 3. Проверяем результат
SELECT 
  u.email,
  u.role,
  u.full_name,
  au.email_confirmed_at,
  au.created_at
FROM users u
JOIN auth.users au ON u.id = au.id
WHERE u.email IN ('admin@a6jrm.org', 'user@a6jrm.org')
ORDER BY u.role DESC, u.email;
