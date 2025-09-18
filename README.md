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

## 📚 Документация

Подробная документация находится в папке `docs/`:

- [Настройка аутентификации](docs/AUTH_SETUP.md)
- [Настройка Supabase](docs/SUPABASE_SETUP.md)
- [Быстрый старт](docs/QUICK_START_AUTH.md)
- [Руководство по тестированию](docs/FINAL_TESTING_GUIDE.md)

## 🛠️ Технологии

- **Backend**: Node.js + Express.js + TypeScript
- **Frontend**: EJS + Bootstrap 5
- **База данных**: Supabase (PostgreSQL)
- **Аутентификация**: Supabase Auth
- **Стили**: Bootstrap 5 + Custom CSS

## 📝 Лицензия

Этот проект предназначен для внутреннего использования авиационной компании.

## 🤝 Поддержка

Для получения помощи обратитесь к документации в папке `docs/` или к администратору системы.
