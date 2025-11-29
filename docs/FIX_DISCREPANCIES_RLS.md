# Fix RLS Policy Error for Discrepancies

## Проблема
При добавлении нового возражения (discrepancy) на Railway возникает ошибка:
```
Failed to add discrepancy: Failed to add discrepancy to database: new row violates row-level security policy for table "discrepancies"
```

## Причина
Row Level Security (RLS) был включен для таблицы `discrepancies`, но таблицы `flights` и `invoices` работают без RLS. Для консистентности и простоты, RLS должен быть отключен для `discrepancies`, как и для других таблиц.

## Решение

### Отключить RLS для таблицы discrepancies

Выполните SQL скрипт `scripts/fix_discrepancies_rls.sql` в Supabase SQL Editor:

1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Скопируйте и выполните содержимое `scripts/fix_discrepancies_rls.sql`

Этот скрипт:
- Удалит все существующие RLS политики
- Отключит RLS для таблицы `discrepancies`
- Сделает таблицу `discrepancies` такой же, как `flights` и `invoices` (без RLS)

## Альтернативное решение (если нужно оставить RLS)

Если вы хотите оставить RLS включенным, убедитесь, что:
1. На Railway установлена переменная `SUPABASE_SERVICE_ROLE_KEY` (не `SUPABASE_ANON_KEY`)
2. Service Role Key автоматически обходит RLS

## Проверка

После применения исправлений:
1. Попробуйте добавить новое возражение на Railway
2. Ошибка RLS больше не должна возникать
3. Таблица `discrepancies` будет работать так же, как `flights` и `invoices`

## Важные замечания

- Таблицы `flights` и `invoices` работают без RLS
- Для консистентности, `discrepancies` также должна работать без RLS
- Сервер использует `SUPABASE_SERVICE_ROLE_KEY`, который имеет полный доступ к базе данных
- RLS полезен для клиентских приложений, но не нужен для серверных операций с service role key

