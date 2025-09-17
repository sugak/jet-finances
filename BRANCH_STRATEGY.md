# 🌿 Git Branch Strategy

## 📋 Структура веток

### `main` - Production Branch

- **Назначение**: Стабильная версия для продакшена
- **Деплой**: Автоматически деплоится на Railway
- **Обновление**: Только через Pull Request из `development`
- **Статус**: Готов к деплою на Railway

### `development` - Development Branch

- **Назначение**: Основная ветка для разработки
- **Использование**: Все новые изменения делаются здесь
- **Обновление**: Прямые коммиты и feature ветки
- **Статус**: Текущая рабочая ветка

## 🔄 Workflow

### Для разработки:

```bash
# Переключиться на development
git checkout development

# Создать feature ветку (опционально)
git checkout -b feature/new-feature

# Делать изменения, коммиты
git add .
git commit -m "Add new feature"

# Отправить в development
git push origin development
```

### Для деплоя в продакшен:

```bash
# Переключиться на main
git checkout main

# Слить изменения из development
git merge development

# Отправить в main (запустит деплой на Railway)
git push origin main
```

## 🚀 Railway Configuration

Railway настроен на автоматический деплой из ветки `main`:

- При push в `main` → автоматический деплой на Railway
- Ветка `development` используется только для разработки
- Продакшен обновляется только через `main`

## 📝 Рекомендации

1. **Всегда работайте в `development`** для новых изменений
2. **Тестируйте в `development`** перед мержем в `main`
3. **Используйте Pull Request** для мержа `development` → `main`
4. **Документируйте изменения** в коммитах
5. **Создавайте feature ветки** для больших изменений

## 🔗 Ссылки

- **Development**: https://github.com/sugak/jet-finances/tree/development
- **Main**: https://github.com/sugak/jet-finances/tree/main
- **Pull Request**: https://github.com/sugak/jet-finances/pull/new/development
