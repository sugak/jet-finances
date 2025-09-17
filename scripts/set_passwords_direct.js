// Скрипт для прямой установки паролей без отправки email
// Запустите: node scripts/set_passwords_direct.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    '❌ Необходимо установить SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

// Создаем клиент с service role key для админских операций
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Конфигурация пользователей и их новых паролей
const users = [
  {
    email: 'admin@a6jrm.org',
    password: 'Admin123!',
    role: 'superadmin',
  },
  {
    email: 'user@a6jrm.org',
    password: 'User123!',
    role: 'reader',
  },
];

async function setUserPassword(email, password) {
  try {
    console.log(`🔄 Установка пароля для: ${email}`);

    // Обновляем пароль пользователя
    const { data, error } = await supabase.auth.admin.updateUserById(
      // Сначала получаем ID пользователя
      await getUserIdByEmail(email),
      {
        password: password,
        email_confirm: true,
      }
    );

    if (error) {
      console.error(`❌ Ошибка для ${email}:`, error.message);
      return false;
    }

    console.log(`✅ Пароль установлен для ${email}`);
    return true;
  } catch (error) {
    console.error(`❌ Исключение для ${email}:`, error.message);
    return false;
  }
}

async function getUserIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();

  if (error) {
    throw new Error(`Ошибка получения пользователей: ${error.message}`);
  }

  const user = data.users.find(u => u.email === email);
  if (!user) {
    throw new Error(`Пользователь ${email} не найден`);
  }

  return user.id;
}

async function ensureUserExists(email, role) {
  try {
    // Проверяем, существует ли пользователь
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers.users.find(u => u.email === email);

    if (existingUser) {
      console.log(`✅ Пользователь ${email} уже существует`);
      return existingUser.id;
    }

    // Создаем нового пользователя
    console.log(`🔄 Создание пользователя: ${email}`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: email,
      password: 'TempPassword123!', // Временный пароль
      email_confirm: true,
    });

    if (error) {
      throw new Error(`Ошибка создания пользователя: ${error.message}`);
    }

    console.log(`✅ Пользователь ${email} создан`);
    return data.user.id;
  } catch (error) {
    console.error(`❌ Ошибка для ${email}:`, error.message);
    throw error;
  }
}

async function updateUserRole(userId, role, email) {
  try {
    // Обновляем роль в таблице users
    const { error } = await supabase.from('users').upsert({
      id: userId,
      email: email,
      role: role,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.warn(`⚠️ Не удалось обновить роль для ${userId}:`, error.message);
    } else {
      console.log(`✅ Роль ${role} установлена для пользователя ${email}`);
    }
  } catch (error) {
    console.warn(`⚠️ Ошибка обновления роли:`, error.message);
  }
}

async function main() {
  console.log('🚀 Начинаем установку паролей...\n');

  for (const user of users) {
    try {
      console.log(`\n📧 Обрабатываем: ${user.email}`);

      // Убеждаемся, что пользователь существует
      const userId = await ensureUserExists(user.email, user.role);

      // Устанавливаем пароль
      await setUserPassword(user.email, user.password);

      // Обновляем роль
      await updateUserRole(userId, user.role, user.email);

      console.log(`✅ ${user.email} готов к использованию`);
      console.log(`   Пароль: ${user.password}`);
      console.log(`   Роль: ${user.role}`);
    } catch (error) {
      console.error(`❌ Критическая ошибка для ${user.email}:`, error.message);
    }
  }

  console.log('\n🎉 Процесс завершен!');
  console.log('\n📋 Данные для входа:');
  users.forEach(user => {
    console.log(`   ${user.email} / ${user.password} (${user.role})`);
  });
}

main().catch(console.error);
