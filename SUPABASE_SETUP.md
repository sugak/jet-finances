# Настройка Supabase для Jet Finances

## Текущий статус

❌ **Соединение с Supabase не настроено**

## Что нужно сделать

### 1. Создать файл .env

Создайте файл `.env` в корне проекта со следующим содержимым:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Server Configuration
PORT=3000
SESSION_SECRET=your_session_secret_here
```

### 2. Получить данные от Supabase

1. Зайдите в [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите ваш проект или создайте новый
3. Перейдите в **Settings** → **API**
4. Скопируйте:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Проверить соединение

После настройки переменных окружения:

1. Перезапустите сервер: `npm run dev`
2. Проверьте соединение: `curl http://localhost:3000/api/health/supabase`
3. Или откройте в браузере: http://localhost:3000/api/health/supabase

## Доступные эндпоинты

- **GET /** - Главная страница (Dashboard)
- **GET /api/health/supabase** - Проверка соединения с Supabase

## Логи при запуске

При запуске сервера вы увидите:

- ✅ `Supabase connection successful!` - если соединение работает
- ❌ `Supabase connection failed` - если есть проблемы

## Безопасность

- **НИКОГДА** не коммитьте файл `.env` в git
- Используйте `SUPABASE_SERVICE_ROLE_KEY` только на сервере
- Для клиентской части используйте `SUPABASE_ANON_KEY`
