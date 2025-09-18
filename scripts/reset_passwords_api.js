// Скрипт для сброса паролей через Supabase API
// Запустите: node scripts/reset_passwords_api.js

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

async function resetUserPassword(email) {
  try {
    console.log(`🔄 Сброс пароля для: ${email}`);

    // Отправляем recovery email
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${process.env.SUPABASE_URL}/auth/callback`,
      },
    });

    if (error) {
      console.error(`❌ Ошибка для ${email}:`, error.message);
      return false;
    }

    console.log(`✅ Recovery link сгенерирован для ${email}`);
    console.log(`🔗 Ссылка: ${data.properties.action_link}`);

    return true;
  } catch (error) {
    console.error(`❌ Исключение для ${email}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Начинаем сброс паролей...\n');

  const users = ['m.a.sugak@gmail.com', 'rts@a6jrm.org'];

  for (const email of users) {
    await resetUserPassword(email);
    console.log(''); // Пустая строка для разделения
  }

  console.log('✅ Процесс завершен!');
  console.log('📧 Пользователи получат email с ссылками для смены пароля');
}

main().catch(console.error);
