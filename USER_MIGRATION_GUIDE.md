# 🔄 Руководство по миграции пользователей

## 📋 Новые пользователи

### ✅ **Активные пользователи:**

- **m.a.sugak@gmail.com** - полный админ со всеми правами (superadmin)
- **rts@a6jrm.org** - пользователь только на чтение (reader)

### ❌ **Старые пользователи (удалены):**

- ~~admin@a6jrm.org~~ - удален
- ~~user@a6jrm.org~~ - удален

## 🚀 Пошаговая миграция

### 1. **Создайте новых пользователей в Supabase**

- Перейдите в Supabase Dashboard → Authentication → Users
- Создайте пользователей:
  - `m.a.sugak@gmail.com` (superadmin)
  - `rts@a6jrm.org` (reader)

### 2. **Установите пароли для новых пользователей**

```bash
# Запустите скрипт установки паролей
node scripts/set_passwords_direct.js
```

### 3. **Удалите права со старых пользователей**

```bash
# Запустите скрипт удаления старых пользователей
node scripts/remove_old_users.js
```

### 4. **Проверьте результат**

```bash
# Проверьте отладку входа
node scripts/debug_login.js
```

## 📋 Данные для входа

```
m.a.sugak@gmail.com / Admin123! (superadmin)
rts@a6jrm.org / User123! (reader)
```

## 🔧 Альтернативные способы

### Через SQL (только роли):

```sql
-- Выполните в Supabase SQL Editor
-- scripts/assign_user_roles.sql
```

### Удаление старых пользователей через SQL:

```sql
-- Выполните в Supabase SQL Editor
-- scripts/remove_old_users.sql
```

## ⚠️ Важные замечания

1. **Сначала создайте новых пользователей** в Supabase Dashboard
2. **Затем запустите скрипты** для установки паролей и ролей
3. **Удалите старых пользователей** после проверки работы новых
4. **Сохраните пароли** в безопасном месте
5. **Протестируйте вход** с новыми данными

## 🆘 Если что-то пошло не так

1. **Проверьте переменные окружения** (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
2. **Убедитесь, что пользователи созданы** в Supabase Dashboard
3. **Проверьте логи** в консоли
4. **Используйте аварийный скрипт**: `node scripts/emergency_login_fix.js`

## 📁 Обновленные файлы

- ✅ `scripts/set_passwords_direct.js` - основной скрипт установки паролей
- ✅ `scripts/emergency_login_fix.js` - аварийный скрипт входа
- ✅ `scripts/debug_login.js` - отладочный скрипт
- ✅ `scripts/reset_passwords_api.js` - скрипт сброса паролей
- ✅ `scripts/quick_password_set.sql` - SQL скрипт установки паролей
- ✅ `scripts/reset_user_passwords.sql` - SQL скрипт сброса паролей
- ✅ `scripts/fix_users_table.sql` - SQL скрипт исправления таблицы
- ✅ `scripts/assign_user_roles.sql` - SQL скрипт назначения ролей
- ✅ `scripts/create_users_and_roles.js` - скрипт создания пользователей
- ✅ `scripts/PASSWORD_SETUP_GUIDE.md` - руководство по паролям
- ✅ `scripts/remove_old_users.sql` - SQL скрипт удаления старых пользователей
- ✅ `scripts/remove_old_users.js` - JavaScript скрипт удаления старых пользователей
