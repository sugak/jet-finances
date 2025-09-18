-- SQL скрипт для сброса паролей пользователей
-- Выполните этот скрипт в Supabase SQL Editor

-- 1. Сброс пароля для m.a.sugak@gmail.com
-- Пользователь получит email с ссылкой для смены пароля
UPDATE auth.users 
SET 
  email_confirmed_at = NOW(),
  recovery_sent_at = NOW(),
  updated_at = NOW()
WHERE email = 'm.a.sugak@gmail.com';

-- 2. Сброс пароля для rts@a6jrm.org
UPDATE auth.users 
SET 
  email_confirmed_at = NOW(),
  recovery_sent_at = NOW(),
  updated_at = NOW()
WHERE email = 'rts@a6jrm.org';

-- 3. Проверим результат
SELECT 
  id,
  email,
  email_confirmed_at,
  recovery_sent_at,
  created_at,
  updated_at
FROM auth.users 
WHERE email IN ('m.a.sugak@gmail.com', 'rts@a6jrm.org')
ORDER BY email;

-- 4. Дополнительно: можно отправить recovery email программно
-- (Это нужно делать через Supabase API, не через SQL)
