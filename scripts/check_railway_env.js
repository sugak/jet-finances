// Проверка переменных окружения в Railway
// Запустите: node scripts/check_railway_env.js

import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ\n');

const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
];

let allPresent = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: ${value.substring(0, 20)}...`);
  } else {
    console.log(`❌ ${varName}: НЕ УСТАНОВЛЕНА`);
    allPresent = false;
  }
});

console.log('\n📋 ИНСТРУКЦИИ ДЛЯ RAILWAY:');
console.log('1. Зайдите в Railway Dashboard');
console.log('2. Выберите ваш проект');
console.log('3. Перейдите в Variables');
console.log('4. Добавьте следующие переменные:');
console.log('');

if (!allPresent) {
  console.log('⚠️  НЕОБХОДИМО УСТАНОВИТЬ:');
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      console.log(`   ${varName}=your_value_here`);
    }
  });
} else {
  console.log('✅ Все переменные установлены!');
}

console.log('\n🔗 Получите значения из Supabase Dashboard:');
console.log('   Settings → API → Project URL');
console.log('   Settings → API → anon public key');
console.log('   Settings → API → service_role secret key');
