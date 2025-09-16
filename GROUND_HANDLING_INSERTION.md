# Ground Handling Expenses Insertion Scripts

Этот набор скриптов предназначен для добавления расходов на наземное обслуживание (Ground Handling) в базу данных Jet Finances.

## Описание

Скрипты обрабатывают данные о расходах на наземное обслуживание самолета A6-RTS за период июль-август 2024 года и:

1. **Добавляют тип расходов "Ground handling"** в таблицу `expense_types`
2. **Создают подтипы**: `arrival`, `departure`, `Landing Permit`
3. **Разделяют суммы пополам** для расходов на handling (arrival + departure)
4. **Сопоставляют с рейсами** в базе данных по дате и аэропорту
5. **Создают отдельные записи** для каждого типа обслуживания

## Файлы

### 1. `insert_ground_handling_expenses.sql`

**SQL скрипт** для прямого выполнения в Supabase:

- Простой в использовании
- Выполняется одной командой
- Автоматически создает все необходимые типы и подтипы
- Показывает сводку результатов

### 2. `insert_ground_handling_expenses.js`

**JavaScript скрипт** с расширенной функциональностью:

- Более гибкая обработка данных
- Детальное логирование процесса
- Лучшая обработка ошибок
- Возможность настройки через переменные окружения

## Использование

### SQL скрипт (рекомендуется)

1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Скопируйте содержимое `insert_ground_handling_expenses.sql`
4. Выполните скрипт

### JavaScript скрипт

1. Установите зависимости:

```bash
npm install @supabase/supabase-js
```

2. Настройте переменные окружения:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
```

3. Запустите скрипт:

```bash
node insert_ground_handling_expenses.js
```

## Обрабатываемые данные

Скрипт обрабатывает следующие типы расходов:

### Handling Expenses (разделяются на arrival + departure)

- **OJAM**: $4,200.00 USD (25 JUL 2024)
- **HEAL**: $2,714.00 USD (19 JUN 2024)
- **OMDW**: 8,605.39 AED + 9,289.03 AED (08 JUL 2024)
- **LTBA**: $2,318.91 USD (16 AUG 2024)
- **LTFE**: €3,520.00 EUR (04 AUG 2024)
- **LGKL**: €2,530.00 EUR (24 JUL 2024)
- **LTBA**: €1,705.00 EUR (14 AUG 2024)
- **LTBA**: €2,350.00 EUR (16 AUG 2024)

### Arrival-Departure Fees (разделяются на arrival + departure)

- **LTBA**: €140.00 EUR (14 AUG 2024)
- **LTFE**: €140.00 EUR (04 AUG 2024)
- **LTBA**: €140.00 EUR (12 AUG 2024)
- **LTBA**: €140.00 EUR (16 AUG 2024)

### Landing Permits (не разделяются)

- **OMDW**: $200.00 USD (17-19 JUL 2024)

## Результат

После выполнения скрипта в базе данных будут созданы:

1. **Тип расходов**: "Ground handling"
2. **Подтипы расходов**:
   - "arrival" - для расходов на прибытие
   - "departure" - для расходов на отправление
   - "Landing Permit" - для разрешений на посадку

3. **Записи расходов**:
   - Каждый handling expense разделен на 2 записи (arrival + departure)
   - Каждая запись содержит половину от исходной суммы
   - Сопоставление с рейсами по дате и аэропорту
   - Детальные комментарии с указанием типа обслуживания

## Структура создаваемых записей

```sql
-- Пример для OJAM handling
INSERT INTO expenses VALUES (
  'Ground handling',           -- exp_type
  'arrival',                   -- exp_subtype
  'OJAM',                      -- exp_place
  'USD',                       -- exp_currency
  2100.00,                     -- exp_amount (половина от 4200)
  'AUTOSCAN: Handling-25 JUL24, A6-RTS, OJAM - Arrival', -- exp_comments
  [flight_id],                 -- exp_flight (если найден соответствующий рейс)
  NOW(),                       -- created_at
  NOW()                        -- updated_at
);
```

## Проверка результатов

После выполнения скрипта можно проверить результаты:

```sql
-- Сводка по типам расходов
SELECT
    exp_subtype,
    exp_currency,
    COUNT(*) as record_count,
    SUM(exp_amount) as total_amount
FROM expenses
WHERE exp_type = 'Ground handling'
GROUP BY exp_subtype, exp_currency
ORDER BY exp_subtype, exp_currency;

-- Детальная информация с рейсами
SELECT
    e.exp_place,
    e.exp_subtype,
    e.exp_currency,
    e.exp_amount,
    e.exp_comments,
    f.flt_number,
    f.flt_date,
    f.flt_dep,
    f.flt_arr
FROM expenses e
LEFT JOIN flights f ON e.exp_flight = f.id
WHERE e.exp_type = 'Ground handling'
ORDER BY e.exp_place, e.exp_subtype;
```

## Примечания

- Скрипт безопасен для повторного выполнения (использует `ON CONFLICT DO NOTHING`)
- Если соответствующие рейсы не найдены, поле `exp_flight` будет `NULL`
- Суммы округляются до 2 знаков после запятой
- Все временные метки устанавливаются в текущее время
