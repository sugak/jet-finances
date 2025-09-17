# 🚀 Railway Deployment Guide

## Подготовка к деплою

### 1. Переменные окружения в Railway

Настройте следующие переменные в Railway Dashboard:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SESSION_SECRET=your_very_secure_session_secret_here
NODE_ENV=production
```

### 2. Настройка RLS в Supabase

**ВАЖНО**: Перед деплоем выполните следующие SQL скрипты в Supabase:

1. `scripts/setup_auth_database.sql` - настройка аутентификации и RLS
2. `scripts/assign_user_roles.sql` - назначение ролей пользователям
3. `scripts/database_dictionaries.sql` - создание справочников
4. `scripts/create_activity_logs_table.sql` - таблица логов

### 3. Дополнительные RLS политики для продакшена

Выполните в Supabase SQL Editor:

```sql
-- Включить RLS для всех таблиц
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_subtypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Политики для справочников (только чтение для всех авторизованных)
CREATE POLICY "Authenticated users can read expense_types" ON expense_types
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read expense_subtypes" ON expense_subtypes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read invoice_types" ON invoice_types
  FOR SELECT USING (auth.role() = 'authenticated');

-- Политики для справочников (только суперадмин может изменять)
CREATE POLICY "Superadmin can manage expense_types" ON expense_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

CREATE POLICY "Superadmin can manage expense_subtypes" ON expense_subtypes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

CREATE POLICY "Superadmin can manage invoice_types" ON invoice_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- Политики для логов (только суперадмин может читать)
CREATE POLICY "Superadmin can read activity_logs" ON activity_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'superadmin'
    )
  );

-- Политики для логов (система может записывать)
CREATE POLICY "System can insert activity_logs" ON activity_logs
  FOR INSERT WITH CHECK (true);
```

### 4. Настройка CORS в Supabase

В Supabase Dashboard → Settings → API → CORS:

```
https://your-railway-app.railway.app
```

### 5. Проверка безопасности

- ✅ RLS включен для всех таблиц
- ✅ Политики настроены по ролям
- ✅ HTTPS редирект настроен
- ✅ Helmet настроен
- ✅ CSRF protection включен
- ✅ Rate limiting настроен

### 6. Мониторинг

После деплоя проверьте:

- Health check: `https://your-app.railway.app/api/health/supabase`
- Логи в Railway Dashboard
- Логи в Supabase Dashboard

### 7. Резервное копирование

Используйте встроенные API для бэкапа:

- `GET /api/backup/create` - создать бэкап
- `GET /api/backup/info` - информация о данных

## Проблемы и решения

### Проблема: 500 ошибки

- Проверьте переменные окружения
- Проверьте подключение к Supabase
- Проверьте RLS политики

### Проблема: CORS ошибки

- Настройте CORS в Supabase
- Проверьте домен в Railway

### Проблема: Аутентификация не работает

- Проверьте SUPABASE_URL и ключи
- Проверьте настройки аутентификации в Supabase
- Проверьте RLS политики для таблицы users
