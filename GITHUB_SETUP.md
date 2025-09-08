# GitHub Setup & Auto-Push Configuration

## ✅ Что настроено:

### 1. **GitHub Repository**

- 🔗 **URL**: https://github.com/sugak/jet-finances
- 📝 **Описание**: Jet Finances MVP - Financial management application with Supabase integration
- 🌐 **Видимость**: Public

### 2. **Git Hooks (Автоматические пуши)**

- **Pre-commit hook**: Автоматически запускает линтер и форматтер перед коммитом
- **Post-commit hook**: Автоматически пушит изменения в GitHub после коммита

### 3. **GitHub Actions**

- **CI/CD Pipeline**: Автоматическое тестирование и деплой
- **Auto-format**: Автоматическое форматирование кода

### 4. **NPM Scripts**

- `npm run commit "message"` - Коммит с сообщением
- `npm run push` - Пуш в GitHub
- `npm run deploy` - Сборка и пуш
- `npm run auto-commit` - Автоформатирование, линтинг и пуш

## 🚀 Как использовать:

### Автоматические пуши:

```bash
# Обычный коммит (автоматически запушится)
git add .
git commit -m "Your commit message"

# Или используйте npm скрипты
npm run commit "Your commit message"
npm run auto-commit
```

### Ручные операции:

```bash
# Только пуш
npm run push

# Полный деплой
npm run deploy
```

## 🔧 Настройки:

### Git Configuration:

- **User**: Jet Finances
- **Email**: jet-finances@example.com
- **Remote**: origin (https://github.com/sugak/jet-finances.git)

### GitHub Actions:

- **Trigger**: Push to main/develop branches
- **Tests**: ESLint, Prettier, Build
- **Auto-format**: При изменениях в коде

## 📋 Workflow:

1. **Разработка**: Вносите изменения в код
2. **Коммит**: `git commit -m "message"` (автоматически запушится)
3. **GitHub Actions**: Автоматически запускаются тесты
4. **Деплой**: При пуше в main ветку

## 🛠 Troubleshooting:

### Если автопуш не работает:

```bash
# Проверьте статус
git status

# Проверьте remote
git remote -v

# Ручной пуш
git push origin main
```

### Если hooks не работают:

```bash
# Проверьте права
ls -la .git/hooks/

# Переустановите hooks
chmod +x .git/hooks/pre-commit
chmod +x .git/hooks/post-commit
```

## 🔗 Полезные ссылки:

- **Repository**: https://github.com/sugak/jet-finances
- **Actions**: https://github.com/sugak/jet-finances/actions
- **Issues**: https://github.com/sugak/jet-finances/issues
- **Settings**: https://github.com/sugak/jet-finances/settings
