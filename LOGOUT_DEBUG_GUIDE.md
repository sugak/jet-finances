# 🔴 Debug Guide: Logout Button Issues

## Проблема

Кнопка Logout не работает на боевом сервере.

## Решение

Добавлены улучшения для диагностики и исправления проблем с logout:

### 1. Улучшенная logout функция

- Добавлено подробное логирование с эмодзи 🔴
- Улучшена обработка ошибок
- Добавлен резервный event listener
- Принудительная очистка cookies

### 2. Тестовые страницы

Созданы тестовые страницы для диагностики:

- `/test-logout` - полная тестовая страница
- `/test-logout-simple` - простая тестовая страница
- `/test-logout-no-auth` - тест без аутентификации

### 3. Отладочная информация

В консоли браузера теперь отображается:

- 🔧 Загрузка скриптов
- 🔴 Вызов logout функции
- 🧪 Тестовые функции
- 🔍 Проверка статуса сессии

## Как тестировать

### 1. Откройте консоль браузера (F12)

### 2. Перейдите на любую страницу приложения

### 3. Проверьте логи в консоли:

```
🔧 Layout script loaded
🔧 window.logout function defined: function
🔧 window.testLogout function defined: function
```

### 4. Нажмите кнопку Logout

### 5. Проверьте логи:

```
🔴 Logout function called
🔴 Current URL: http://localhost:3000/
🔴 Current cookies: sb-access-token=...
🔴 Making logout request...
🔴 Logout response status: 200
🔴 Logout response ok: true
🔴 Logout successful, clearing data...
🔴 Redirecting to login page...
```

### 6. Если кнопка не работает, попробуйте в консоли:

```javascript
// Проверить, определена ли функция
console.log(typeof window.logout);

// Вызвать функцию напрямую
window.logout();

// Или использовать тестовую функцию
window.testLogout();
```

## Тестовые страницы

### `/test-logout-no-auth`

- Не требует аутентификации
- Тестирует API endpoints
- Показывает подробные логи

### `/test-logout-simple`

- Минимальная тестовая страница
- Простая проверка logout API

## Возможные проблемы

### 1. JavaScript не загружается

**Симптомы:** Нет логов в консоли
**Решение:** Проверить CSP настройки, загружены ли скрипты

### 2. Функция не определена

**Симптомы:** `window.logout is not a function`
**Решение:** Проверить, что layout.ejs загружается правильно

### 3. CORS проблемы

**Симптомы:** Ошибки fetch в консоли
**Решение:** Проверить настройки credentials: 'include'

### 4. Cookies не очищаются

**Симптомы:** После logout остается сессия
**Решение:** Проверить настройки sameSite и secure

## Команды для проверки

```bash
# Проверить logout API
curl -X POST http://localhost:3000/api/auth/logout

# Проверить статус сессии
curl http://localhost:3000/api/auth/status

# Проверить health check
curl http://localhost:3000/api/health/supabase
```

## Следующие шаги

1. Протестировать на локальном сервере
2. Проверить логи в консоли браузера
3. Если все работает локально, развернуть на боевом сервере
4. Проверить на боевом сервере с тестовыми страницами
5. Удалить тестовые страницы после исправления
