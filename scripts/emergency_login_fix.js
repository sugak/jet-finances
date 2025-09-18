// Экстренное исправление логина
// Запустите: node scripts/emergency_login_fix.js

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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function emergencyFix() {
  console.log('🚨 ЭКСТРЕННОЕ ИСПРАВЛЕНИЕ ЛОГИНА\n');

  try {
    // 1. Создаем пользователей заново
    console.log('🔄 Создаем пользователей...');

    const users = [
      {
        email: 'm.a.sugak@gmail.com',
        password: 'Admin123!',
        role: 'superadmin',
      },
      {
        email: 'rts@a6jrm.org',
        password: 'User123!',
        role: 'reader',
      },
    ];

    for (const user of users) {
      console.log(`\n📧 Обрабатываем: ${user.email}`);

      // Удаляем существующего пользователя
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers.users.find(
        u => u.email === user.email
      );

      if (existingUser) {
        console.log(`🗑️ Удаляем существующего пользователя: ${user.email}`);
        await supabase.auth.admin.deleteUser(existingUser.id);
      }

      // Создаем нового пользователя
      console.log(`➕ Создаем нового пользователя: ${user.email}`);
      const { data: newUser, error: createError } =
        await supabase.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
        });

      if (createError) {
        console.error(`❌ Ошибка создания: ${createError.message}`);
        continue;
      }

      console.log(`✅ Пользователь создан: ${user.email}`);

      // Добавляем в таблицу users
      const { error: roleError } = await supabase.from('users').upsert({
        id: newUser.user.id,
        email: user.email,
        role: user.role,
        full_name: user.role === 'superadmin' ? 'Admin User' : 'Regular User',
        updated_at: new Date().toISOString(),
      });

      if (roleError) {
        console.error(`❌ Ошибка роли: ${roleError.message}`);
      } else {
        console.log(`✅ Роль ${user.role} назначена`);
      }
    }

    console.log('\n🎉 ЭКСТРЕННОЕ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!');
    console.log('\n📋 Данные для входа:');
    console.log('   m.a.sugak@gmail.com / Admin123!');
    console.log('   rts@a6jrm.org / User123!');

    console.log('\n💡 Теперь попробуйте войти в приложение!');
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
  }
}

emergencyFix().catch(console.error);
