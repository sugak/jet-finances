// Скрипт для удаления прав со старых пользователей
// Запустите: node scripts/remove_old_users.js

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

// Старые пользователи для удаления
const oldUsers = ['admin@a6jrm.org', 'user@a6jrm.org'];

async function removeUserFromUsersTable(email) {
  try {
    console.log(`🔄 Удаляем пользователя ${email} из таблицы users...`);

    const { error } = await supabase.from('users').delete().eq('email', email);

    if (error) {
      console.error(`❌ Ошибка удаления ${email}:`, error.message);
      return false;
    }

    console.log(`✅ Пользователь ${email} удален из таблицы users`);
    return true;
  } catch (error) {
    console.error(`❌ Исключение для ${email}:`, error.message);
    return false;
  }
}

async function deactivateUserInAuth(email) {
  try {
    console.log(`🔄 Деактивируем пользователя ${email} в auth.users...`);

    // Получаем ID пользователя
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const user = authUsers.users.find(u => u.email === email);

    if (!user) {
      console.log(`⚠️ Пользователь ${email} не найден в auth.users`);
      return true;
    }

    // Деактивируем пользователя (устанавливаем banned_until)
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      ban_duration: '876000h', // ~100 лет
    });

    if (error) {
      console.error(`❌ Ошибка деактивации ${email}:`, error.message);
      return false;
    }

    console.log(`✅ Пользователь ${email} деактивирован в auth.users`);
    return true;
  } catch (error) {
    console.error(`❌ Исключение для ${email}:`, error.message);
    return false;
  }
}

async function showCurrentUsers() {
  try {
    console.log('\n📋 Текущие активные пользователи:');

    const { data: users, error } = await supabase
      .from('users')
      .select('email, role, full_name, created_at')
      .order('role', { ascending: false })
      .order('email');

    if (error) {
      console.error('❌ Ошибка получения пользователей:', error.message);
      return;
    }

    if (users.length === 0) {
      console.log('   Нет активных пользователей');
    } else {
      users.forEach(user => {
        console.log(`   ${user.email} (${user.role}) - ${user.full_name}`);
      });
    }
  } catch (error) {
    console.error('❌ Ошибка показа пользователей:', error.message);
  }
}

async function main() {
  console.log('🚀 Начинаем удаление старых пользователей...\n');

  for (const email of oldUsers) {
    try {
      console.log(`\n📧 Обрабатываем: ${email}`);

      // Удаляем из таблицы users
      await removeUserFromUsersTable(email);

      // Деактивируем в auth.users
      await deactivateUserInAuth(email);

      console.log(`✅ ${email} обработан`);
    } catch (error) {
      console.error(`❌ Критическая ошибка для ${email}:`, error.message);
    }
  }

  console.log('\n🎉 Процесс завершен!');

  // Показываем текущих пользователей
  await showCurrentUsers();

  console.log('\n💡 Старые пользователи удалены из системы!');
}

main().catch(console.error);
