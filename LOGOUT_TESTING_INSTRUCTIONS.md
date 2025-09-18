# 🔴 Инструкции по тестированию Logout

## Проблема

Кнопка Logout не работает на боевом сервере.

## Исправления

1. ✅ **Исправлены CSP ошибки** - добавлено разрешение для source maps
2. ✅ **Перемещен Bootstrap JavaScript** в head для ранней загрузки
3. ✅ **Добавлена отладочная информация** с эмодзи для легкой идентификации
4. ✅ **Созданы тестовые страницы** для диагностики

## Тестовые страницы

### 1. `/test-logout-minimal` - Минимальная версия

- Без Bootstrap и внешних зависимостей
- Простая проверка logout API
- Подробные логи с цветовой кодировкой

### 2. `/test-logout-no-auth` - Без аутентификации

- Не требует входа в систему
- Тестирует API endpoints
- Показывает статус сессии

### 3. `/test-logout-simple` - Простая версия

- Минимальная функциональность
- Быстрая проверка

## Как тестировать

### Шаг 1: Откройте консоль браузера (F12)

### Шаг 2: Перейдите на тестовую страницу

```
http://localhost:3000/test-logout-minimal
```

### Шаг 3: Проверьте логи в консоли

Должны появиться:

```
🔧 Bootstrap JS loaded successfully
🔧 Layout script loaded
🔧 window.logout function defined: function
```

### Шаг 4: Нажмите "Test Logout"

Проверьте логи:

```
🔴 Starting logout test...
🔴 Response status: 200
🔴 Response ok: true
✅ Logout successful!
```

### Шаг 5: Если кнопка не работает

Попробуйте в консоли:

```javascript
// Проверить функцию
console.log(typeof window.logout);

// Вызвать напрямую
window.logout();

// Или использовать тестовую функцию
window.testLogout();
```

## Проверка на боевом сервере

1. Разверните изменения на боевом сервере
2. Откройте тестовую страницу: `https://your-domain.com/test-logout-minimal`
3. Проверьте логи в консоли браузера
4. Протестируйте logout функциональность

## Возможные проблемы

### CSP ошибки

**Симптомы:** Ошибки в консоли о Content Security Policy
**Решение:** Проверить, что `https://cdn.jsdelivr.net` добавлен в `connect-src`

### Bootstrap не загружается

**Симптомы:** `Bootstrap JS failed to load` в консоли
**Решение:** Проверить интернет соединение и доступность CDN

### Функция не определена

**Симптомы:** `window.logout is not a function`
**Решение:** Проверить, что layout.ejs загружается правильно

## Команды для проверки

```bash
# Проверить logout API
curl -X POST http://localhost:3000/api/auth/logout

# Проверить статус сессии
curl http://localhost:3000/api/auth/status

# Проверить health check
curl http://localhost:3000/api/health/supabase
```

## После исправления

1. Удалите тестовые файлы:
   - `test-logout.html`
   - `test-logout-simple.html`
   - `test-logout-no-auth.html`
   - `test-logout-minimal.html`
   - `LOGOUT_DEBUG_GUIDE.md`
   - `LOGOUT_TESTING_INSTRUCTIONS.md`

2. Удалите тестовые маршруты из `src/server/index.ts`

3. Очистите отладочные логи из `src/views/layout.ejs`
