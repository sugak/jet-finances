# 🚀 Jet Finances

Система управления финансами для авиационной компании с аутентификацией пользователей и ролевой моделью доступа.

## 📁 Структура проекта

```
jet-finances/
├── 📁 src/                    # Исходный код
│   ├── 📁 server/            # Серверная часть (TypeScript)
│   │   └── index.ts          # Главный файл сервера
│   └── 📁 views/             # Шаблоны EJS
│       ├── layout.ejs        # Основной layout
│       ├── 📁 auth/          # Страницы аутентификации
│       ├── 📁 dashboard/     # Главная страница
│       ├── 📁 flights/       # Управление рейсами
│       ├── 📁 expenses/      # Управление расходами
│       ├── 📁 invoices/      # Управление счетами
│       ├── 📁 reports/       # Отчеты
│       ├── 📁 settings/      # Настройки
│       └── 📁 logs/          # Логи системы
├── 📁 public/                # Статические файлы
│   ├── 📁 css/              # Стили
│   ├── 📁 js/               # JavaScript файлы
│   └── 📁 images/           # Изображения
├── 📁 docs/                 # Документация
│   ├── README.md            # Основная документация
│   ├── AUTH_SETUP.md        # Настройка аутентификации
│   ├── SUPABASE_SETUP.md    # Настройка Supabase
│   └── ...                  # Другие документы
├── 📁 scripts/              # Скрипты и SQL файлы
│   ├── setup_auth_database.sql
│   ├── create_users_and_roles.js
│   └── ...                  # Другие скрипты
├── 📁 dist/                 # Скомпилированный код
├── package.json             # Зависимости проекта
├── tsconfig.json           # Конфигурация TypeScript
└── README.md               # Этот файл
```

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# App
PORT=3000
NODE_ENV=development
SESSION_SECRET=your_session_secret
```

### 3. Настройка базы данных

Выполните SQL скрипты из папки `scripts/`:

- `setup_auth_database.sql` - настройка аутентификации
- `assign_user_roles.sql` - назначение ролей пользователям

### 4. Запуск приложения

```bash
npm run build  # Компиляция TypeScript
npm start      # Запуск сервера
```

Приложение будет доступно по адресу: http://localhost:3000

## 🔐 Аутентификация

Система использует Supabase для аутентификации с двумя ролями:

- **superadmin** - полный доступ ко всем функциям
- **reader** - только чтение данных

### Пользователи по умолчанию:

- `admin@a6jrm.org` - суперадмин
- `user@a6jrm.org` - обычный пользователь

## 📚 Документация

Подробная документация находится в папке `docs/`:

- [Настройка аутентификации](docs/AUTH_SETUP.md)
- [Настройка Supabase](docs/SUPABASE_SETUP.md)
- [Быстрый старт](docs/QUICK_START_AUTH.md)
- [Руководство по тестированию](docs/FINAL_TESTING_GUIDE.md)

## 🛠️ Разработка

### Команды:

```bash
npm run build    # Компиляция TypeScript
npm start        # Запуск в продакшене
npm run dev      # Запуск в режиме разработки (если настроен)
```

### Технологии:

- **Backend**: Node.js + Express.js + TypeScript
- **Frontend**: EJS + Bootstrap 5
- **База данных**: Supabase (PostgreSQL)
- **Аутентификация**: Supabase Auth
- **Стили**: Bootstrap 5 + Custom CSS

## 📝 Лицензия

Этот проект предназначен для внутреннего использования авиационной компании.

## 🤝 Поддержка

Для получения помощи обратитесь к документации в папке `docs/` или к администратору системы.
