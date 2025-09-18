import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createUsersAndRoles() {
  try {
    console.log('🔍 Creating users and roles...');

    // 1. Create users table if it doesn't exist
    console.log('\n1. Creating users table...');
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID REFERENCES auth.users(id) PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('superadmin', 'reader')),
        full_name TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    const { error: createError } = await supabase.rpc('exec', {
      sql: createTableSQL,
    });
    if (createError) {
      console.log('   Table creation error:', createError.message);
    } else {
      console.log('   ✅ Users table created/verified');
    }

    // 2. Enable RLS
    console.log('\n2. Enabling RLS...');
    const enableRLSSQL = `ALTER TABLE users ENABLE ROW LEVEL SECURITY;`;
    await supabase.rpc('exec', { sql: enableRLSSQL });

    // 3. Create policies
    console.log('\n3. Creating policies...');
    const policiesSQL = `
      DROP POLICY IF EXISTS "Users can view own profile" ON users;
      CREATE POLICY "Users can view own profile" ON users
        FOR SELECT USING (auth.uid() = id);

      DROP POLICY IF EXISTS "Users can update own profile" ON users;
      CREATE POLICY "Users can update own profile" ON users
        FOR UPDATE USING (auth.uid() = id);
    `;
    await supabase.rpc('exec', { sql: policiesSQL });

    // 4. Check if users exist in auth.users
    console.log('\n4. Checking existing users...');
    const { data: authUsers, error: authError } =
      await supabase.auth.admin.listUsers();

    if (authError) {
      console.log('   Auth users error:', authError.message);
    } else {
      console.log('   Found', authUsers.users.length, 'users in auth.users');

      const adminUser = authUsers.users.find(
        u => u.email === 'm.a.sugak@gmail.com'
      );
      const regularUser = authUsers.users.find(
        u => u.email === 'rts@a6jrm.org'
      );

      if (adminUser) {
        console.log('   ✅ m.a.sugak@gmail.com found');
      } else {
        console.log('   ❌ m.a.sugak@gmail.com not found');
      }

      if (regularUser) {
        console.log('   ✅ rts@a6jrm.org found');
      } else {
        console.log('   ❌ rts@a6jrm.org not found');
      }
    }

    // 5. Insert roles for existing users
    console.log('\n5. Assigning roles...');
    const insertRolesSQL = `
      INSERT INTO users (id, email, role, full_name) VALUES
        (
          (SELECT id FROM auth.users WHERE email = 'm.a.sugak@gmail.com'),
          'm.a.sugak@gmail.com',
          'superadmin',
          'Admin User'
        ),
        (
          (SELECT id FROM auth.users WHERE email = 'rts@a6jrm.org'),
          'rts@a6jrm.org',
          'reader',
          'Regular User'
        )
      ON CONFLICT (id) DO UPDATE SET
        role = EXCLUDED.role,
        full_name = EXCLUDED.full_name,
        updated_at = NOW();
    `;

    const { error: insertError } = await supabase.rpc('exec', {
      sql: insertRolesSQL,
    });
    if (insertError) {
      console.log('   Insert roles error:', insertError.message);
    } else {
      console.log('   ✅ Roles assigned successfully');
    }

    // 6. Verify roles
    console.log('\n6. Verifying roles...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');
    if (usersError) {
      console.log('   Users query error:', usersError.message);
    } else {
      console.log('   Users with roles:');
      users.forEach(user => {
        console.log(`   - ${user.email}: ${user.role}`);
      });
    }

    console.log('\n✅ Setup completed!');
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

createUsersAndRoles();
