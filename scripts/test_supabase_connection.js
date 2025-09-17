import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase connection...');
console.log('URL:', supabaseUrl);
console.log('Key:', supabaseKey ? 'Set' : 'Missing');

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    // Test basic connection
    console.log('\n1. Testing basic connection...');
    const { data, error } = await supabase
      .from('_supabase_migrations')
      .select('*')
      .limit(1);
    if (error) {
      console.log('   Migration table error:', error.message);
    } else {
      console.log('   ✅ Basic connection works');
    }

    // Test auth
    console.log('\n2. Testing auth service...');
    const { data: session, error: authError } =
      await supabase.auth.getSession();
    if (authError) {
      console.log('   Auth error:', authError.message);
    } else {
      console.log('   ✅ Auth service works');
    }

    // Test users table
    console.log('\n3. Testing users table...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');
    if (usersError) {
      console.log('   Users table error:', usersError.message);
      console.log('   This is expected if the table does not exist yet');
    } else {
      console.log('   ✅ Users table accessible, count:', users?.length || 0);
    }

    // Test flights table
    console.log('\n4. Testing flights table...');
    const { data: flights, error: flightsError } = await supabase
      .from('flights')
      .select('*')
      .limit(1);
    if (flightsError) {
      console.log('   Flights table error:', flightsError.message);
    } else {
      console.log(
        '   ✅ Flights table accessible, count:',
        flights?.length || 0
      );
    }

    console.log('\n✅ Supabase connection test completed');
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
  }
}

testConnection();
