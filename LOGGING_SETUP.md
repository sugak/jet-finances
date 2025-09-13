# Система логирования Jet Finances

## Обзор

В приложение Jet Finances добавлена система логирования всех CRUD операций. Система отслеживает:

- ✅ CREATE операции (создание новых записей)
- ✅ UPDATE операции (изменение записей)
- ✅ DELETE операции (удаление записей)
- ✅ Информацию о пользователе и времени
- ✅ IP адреса и User-Agent
- ✅ Старые и новые данные для изменений

## Текущее состояние

### ✅ Реализовано

1. **Функция логирования** - `logActivity()` в `src/server/index.ts`
2. **Логирование во всех API endpoints**:
   - `POST /api/expense-types` - создание типов расходов
   - `DELETE /api/expense-types/:id` - удаление типов расходов
   - `POST /api/expense-subtypes` - создание подтипов расходов
   - `DELETE /api/expense-subtypes/:id` - удаление подтипов расходов
   - `POST /api/invoice-types` - создание типов инвойсов
   - `DELETE /api/invoice-types/:id` - удаление типов инвойсов
   - `POST /api/flights` - создание рейсов
   - `DELETE /api/flights/:id` - удаление рейсов
   - `POST /api/invoices` - создание инвойсов
   - `DELETE /api/invoices/:id` - удаление инвойсов

3. **Страница Logs** - `/logs` с красивым интерфейсом
4. **Консольное логирование** - все операции логируются в консоль сервера

### 🔄 В процессе

- **База данных логирования** - таблица `activity_logs` готова к созданию

## Настройка базы данных

### Шаг 1: Создание таблицы activity_logs

Выполните SQL скрипт в вашей Supabase базе данных:

```sql
-- Файл: create_activity_logs_table.sql
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) DEFAULT 'system',
    action VARCHAR(20) NOT NULL, -- CREATE, UPDATE, DELETE
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание индексов для производительности
CREATE INDEX IF NOT EXISTS idx_activity_logs_table_name ON activity_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
```

### Шаг 2: Проверка работы

После создания таблицы:

1. Перезапустите сервер
2. Выполните любые CRUD операции
3. Перейдите на страницу `/logs` - логи должны отображаться в таблице

## Структура логов

Каждый лог содержит:

- **timestamp** - время операции
- **user_id** - идентификатор пользователя (по умолчанию 'system')
- **action** - тип операции (CREATE, UPDATE, DELETE)
- **table_name** - название таблицы
- **record_id** - ID записи
- **old_data** - старые данные (для UPDATE/DELETE)
- **new_data** - новые данные (для CREATE/UPDATE)
- **ip_address** - IP адрес клиента
- **user_agent** - информация о браузере

## Примеры логов

### Создание записи

```json
{
  "timestamp": "2025-09-13T13:09:49.330Z",
  "user_id": "system",
  "action": "CREATE",
  "table_name": "expense_types",
  "record_id": "f51c43e3-cfd4-4463-8005-82ded5e626e2",
  "old_data": null,
  "new_data": {
    "id": "f51c43e3-cfd4-4463-8005-82ded5e626e2",
    "name": "Test Logging Complete",
    "description": "Testing complete logging system",
    "created_at": "2025-09-13T13:09:49.330156+00:00",
    "updated_at": "2025-09-13T13:09:49.330156+00:00"
  },
  "ip_address": "::1",
  "user_agent": "curl/7.68.0"
}
```

### Удаление записи

```json
{
  "timestamp": "2025-09-13T13:10:15.123Z",
  "user_id": "system",
  "action": "DELETE",
  "table_name": "expense_types",
  "record_id": "f51c43e3-cfd4-4463-8005-82ded5e626e2",
  "old_data": {
    "id": "f51c43e3-cfd4-4463-8005-82ded5e626e2",
    "name": "Test Logging Complete",
    "description": "Testing complete logging system"
  },
  "new_data": null,
  "ip_address": "::1",
  "user_agent": "curl/7.68.0"
}
```

## Мониторинг

### Консоль сервера

Все операции логируются в консоль сервера с префиксом `🔍 ACTIVITY LOG:`

### Веб-интерфейс

Страница `/logs` показывает:

- Таблицу всех логов
- Фильтрацию по действиям
- Детали изменений
- Временные метки

## Расширение системы

### Добавление логирования в новые endpoints

1. Добавьте вызов `logActivity()` в ваш endpoint:

```typescript
// Для CREATE операций
await logActivity('CREATE', 'table_name', data.id, null, data, 'user_id', req);

// Для UPDATE операций
await logActivity(
  'UPDATE',
  'table_name',
  data.id,
  oldData,
  newData,
  'user_id',
  req
);

// Для DELETE операций
await logActivity(
  'DELETE',
  'table_name',
  recordId,
  oldData,
  null,
  'user_id',
  req
);
```

2. Импортируйте функцию `logActivity` если нужно

### Добавление пользовательской информации

Измените параметр `userId` в вызовах `logActivity()`:

```typescript
// Получение пользователя из сессии/токена
const userId = req.user?.id || 'anonymous';

await logActivity('CREATE', 'table_name', data.id, null, data, userId, req);
```

## Файлы системы

- `src/server/index.ts` - функция `logActivity()` и интеграция
- `src/views/logs/index.ejs` - страница просмотра логов
- `create_activity_logs_table.sql` - SQL для создания таблицы
- `database_dictionaries.sql` - обновлен с таблицей логов

## Поддержка

Система логирования работает независимо от основного функционала. Если база данных логов недоступна, логирование продолжается в консоль.
