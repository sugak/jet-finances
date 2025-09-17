// Диагностический скрипт для проверки логина
// Запустите: node scripts/debug_login.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

console.log('🔍 Диагностика Supabase конфигурации...\n');

// Проверяем переменные окружения
console.log('📋 Переменные окружения:');
console.log(
  `SUPABASE_URL: ${supabaseUrl ? '✅ Установлен' : '❌ Отсутствует'}`
);
console.log(
  `SUPABASE_ANON_KEY: ${supabaseAnonKey ? '✅ Установлен' : '❌ Отсутствует'}`
);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('\n❌ Критическая ошибка: отсутствуют переменные окружения');
  process.exit(1);
}

// Создаем клиент
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
  console.log('\n🔄 Тестируем подключение к Supabase...');

  try {
    // Тест 1: Проверяем подключение
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error('❌ Ошибка подключения:', error.message);
      return false;
    }

    console.log('✅ Подключение к Supabase работает');

    // Тест 2: Проверяем список пользователей
    console.log('\n🔄 Проверяем пользователей...');

    // Попробуем получить информацию о проекте
    const { data: projectData, error: projectError } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    if (projectError) {
      console.error('❌ Ошибка доступа к таблице users:', projectError.message);
      console.log('💡 Возможно, нужно выполнить SQL скрипты настройки');
      return false;
    }

    console.log('✅ Доступ к таблице users работает');

    // Тест 3: Проверяем аутентификацию
    console.log('\n🔄 Тестируем аутентификацию...');

    const testEmail = 'admin@a6jrm.org';
    const testPassword = 'Admin123!';

    console.log(`Попытка входа: ${testEmail}`);

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

    if (authError) {
      console.error('❌ Ошибка аутентификации:', authError.message);
      console.log(
        '💡 Возможно, пользователь не существует или неправильный пароль'
      );
      return false;
    }

    console.log('✅ Аутентификация работает');
    console.log(`Пользователь: ${authData.user.email}`);
    console.log(`ID: ${authData.user.id}`);

    // Выходим из системы
    await supabase.auth.signOut();

    return true;
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    return false;
  }
}

async function checkUsers() {
  console.log('\n🔄 Проверяем существующих пользователей...');

  try {
    const { data, error } = await supabase.from('users').select('*');

    if (error) {
      console.error('❌ Ошибка получения пользователей:', error.message);
      return;
    }

    if (data.length === 0) {
      console.log('⚠️ Пользователи не найдены в таблице users');
      console.log('💡 Запустите скрипт: node scripts/set_passwords_direct.js');
    } else {
      console.log('✅ Найденные пользователи:');
      data.forEach(user => {
        console.log(`   ${user.email} (${user.role})`);
      });
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

async function main() {
  const connectionOk = await testConnection();

  if (connectionOk) {
    await checkUsers();

    console.log('\n🎉 Диагностика завершена успешно!');
    console.log('\n💡 Если логин не работает в браузере:');
    console.log('   1. Проверьте CORS настройки в Supabase');
    console.log('   2. Проверьте Railway домен в CORS');
    console.log('   3. Проверьте логи в Railway Dashboard');
  } else {
    console.log('\n❌ Обнаружены проблемы с конфигурацией');
    console.log('\n💡 Рекомендации:');
    console.log('   1. Проверьте переменные окружения в Railway');
    console.log('   2. Выполните SQL скрипты настройки');
    console.log('   3. Запустите: node scripts/set_passwords_direct.js');
  }
}

main().catch(console.error);
