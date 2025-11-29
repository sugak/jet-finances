# Fix RLS Policy Error for Discrepancies

## Проблема
При добавлении нового возражения (discrepancy) на Railway возникает ошибка:
```
Failed to add discrepancy: Failed to add discrepancy to database: new row violates row-level security policy for table "discrepancies"
```

## Причина
Row Level Security (RLS) политики для таблицы `discrepancies` не настроены правильно. Таблица `flights` имеет следующие RLS политики:
- Authenticated users can read flights (SELECT)
- Superadmin can insert flights (INSERT)
- Superadmin can update flights (UPDATE)
- Superadmin can delete flights (DELETE)

Таблица `discrepancies` должна иметь аналогичные политики.

## Решение

### Создать RLS политики для таблицы discrepancies

Выполните SQL скрипт `scripts/fix_discrepancies_rls.sql` в Supabase SQL Editor:

1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Скопируйте и выполните содержимое `scripts/fix_discrepancies_rls.sql`

Этот скрипт создаст следующие политики:
- **Authenticated users can read discrepancies** - все аутентифицированные пользователи могут читать
- **Superadmin can insert discrepancies** - только superadmin может добавлять
- **Superadmin can update discrepancies** - только superadmin может обновлять
- **Superadmin can delete discrepancies** - только superadmin может удалять
- **Service role can manage discrepancies** - сервер с SERVICE_ROLE_KEY может выполнять все операции

## Важно

1. **На Railway должна быть установлена переменная `SUPABASE_SERVICE_ROLE_KEY`** (не `SUPABASE_ANON_KEY`)
2. Service Role Key использует политику "Service role can manage discrepancies" для обхода проверок
3. Политики для superadmin проверяют роль через таблицу `users`

## Проверка

После применения исправлений:
1. Попробуйте добавить новое возражение на Railway
2. Ошибка RLS больше не должна возникать
3. Таблица `discrepancies` будет работать так же, как `flights` (с RLS, но с правильными политиками)

## Структура политик (как в flights)

- **SELECT**: Все authenticated пользователи
- **INSERT/UPDATE/DELETE**: Только superadmin (проверка через таблицу users)
- **ALL для service_role**: Полный доступ для сервера

