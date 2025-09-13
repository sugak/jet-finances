import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import csrf from 'csurf';
import rateLimit from 'express-rate-limit';
import expressLayouts from 'express-ejs-layouts';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// ---------- Supabase Configuration ----------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Supabase credentials not found in environment variables');
  console.warn(
    '   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in your .env file'
  );
}

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// ---------- Logging Function ----------
async function logActivity(
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  tableName: string,
  recordId: string | null,
  oldData: any = null,
  newData: any = null,
  userId: string = 'system',
  req?: Request
) {
  // Extract record details based on table and data
  let recordDetails = '';

  if (oldData || newData) {
    const data = oldData || newData;

    switch (tableName) {
      case 'flights':
        recordDetails = `Flight: ${data.flt_number || 'N/A'} (${data.flt_dep || 'N/A'} → ${data.flt_arr || 'N/A'})`;
        break;
      case 'invoices':
        recordDetails = `Invoice: ${data.inv_number || 'N/A'} (${data.inv_currency || 'N/A'} ${data.inv_amount || 'N/A'})`;
        break;
      case 'expenses':
        recordDetails = `Expense: ${data.exp_place || 'N/A'} (${data.exp_currency || 'N/A'} ${data.exp_amount || 'N/A'})`;
        break;
      case 'expense_types':
        recordDetails = `Expense Type: ${data.name || 'N/A'}`;
        break;
      case 'expense_subtypes':
        recordDetails = `Expense Subtype: ${data.name || 'N/A'}`;
        break;
      case 'invoice_types':
        recordDetails = `Invoice Type: ${data.name || 'N/A'}`;
        break;
      default:
        recordDetails = `Record ID: ${recordId || 'N/A'}`;
    }
  }

  // Console logging for now (until activity_logs table is created)
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    user_id: userId,
    action,
    table_name: tableName,
    record_id: recordId,
    record_details: recordDetails,
    old_data: oldData,
    new_data: newData,
    ip_address: req ? req.ip || req.connection.remoteAddress : null,
    user_agent: req ? req.get('User-Agent') : null,
  };

  console.log('🔍 ACTIVITY LOG:', JSON.stringify(logEntry, null, 2));

  // Try to log to database if table exists
  if (supabase) {
    try {
      // Remove timestamp field for database insert (created_at is auto-generated)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { timestamp, ...dbLogEntry } = logEntry;

      const { error } = await supabase
        .from('activity_logs')
        .insert([dbLogEntry]);

      if (error) {
        console.warn(
          'Database logging failed (table may not exist):',
          error.message
        );
      }
    } catch (error) {
      console.warn('Database logging error:', error);
    }
  }
}

// ---------- Supabase Connection Test ----------
async function testSupabaseConnection() {
  if (!supabase) {
    console.log(
      '❌ Supabase client not initialized - check your environment variables'
    );
    console.log(
      '   SUPABASE_URL:',
      process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing'
    );
    console.log(
      '   SUPABASE_KEY:',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
        ? '✅ Set'
        : '❌ Missing'
    );
    return false;
  }

  try {
    console.log('🔄 Testing Supabase connection...');
    console.log('   URL:', supabaseUrl);
    console.log(
      '   Key type:',
      process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Service Role' : 'Anon'
    );

    // Простой тест - получаем информацию о проекте
    const { error } = await supabase
      .from('_supabase_migrations')
      .select('*')
      .limit(1);

    if (error) {
      console.log('   Migration table error:', error.message);
      // Если таблица миграций недоступна, попробуем другой способ
      const { error: healthError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .limit(1);

      if (healthError) {
        console.log('   Schema table error:', healthError.message);
        // Попробуем самый простой тест - auth
        const { error: authError } = await supabase.auth.getSession();
        if (authError) {
          console.log('❌ Supabase connection failed:', authError.message);
          return false;
        }
      }
    }

    console.log('✅ Supabase connection successful!');
    return true;
  } catch (err) {
    console.log('❌ Supabase connection error:', err);
    if (err instanceof Error) {
      console.log('   Error details:', err.message);
      console.log('   Error type:', err.constructor.name);
    }
    return false;
  }
}

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ---------- View engine (EJS + layouts) ----------
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'src', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout'); // src/views/layout.ejs

// ---------- Static assets ----------
app.use(
  '/public',
  express.static(path.join(process.cwd(), 'public'), { maxAge: '7d' })
);

// ---------- Core middleware ----------
app.use(morgan('dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));

// ---------- Security ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Разрешаем Bootstrap/HTMX с CDN; расширите при необходимости
        'script-src': [
          "'self'",
          'https://unpkg.com',
          'https://cdn.jsdelivr.net',
          "'unsafe-inline'",
        ],
        'style-src': [
          "'self'",
          'https://cdn.jsdelivr.net',
          'https://unpkg.com',
          "'unsafe-inline'",
        ],
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// rate limiting (120 req/минуту)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// CSRF (cookie-based) - исключаем API эндпоинты
const csrfProtection = csrf({ cookie: true });
app.use((req: Request, res: Response, next: NextFunction) => {
  // Пропускаем CSRF для API эндпоинтов
  if (req.path.startsWith('/api/')) {
    return next();
  }
  return csrfProtection(req, res, next);
});

// пробрасываем CSRF-токен в шаблоны и для HTMX-запросов
app.use((req: Request, res: Response, next: NextFunction) => {
  // Пропускаем установку CSRF токена для API эндпоинтов
  if (req.path.startsWith('/api/')) {
    return next();
  }

  const token = (req as any).csrfToken?.() || res.locals.csrfToken;
  res.locals.csrfToken = token;
  if (token) {
    res.setHeader('X-CSRF-Token', token);
  }
  next();
});

// Тест REST API Supabase
app.get('/api/test/rest', async (_req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res
        .status(500)
        .json({ error: 'Supabase credentials not configured' });
    }

    const results: any = {};

    // Тест внешних соединений
    try {
      const googleResponse = await fetch('https://google.com');
      results.external_connection = {
        status: 'success',
        message: `Google: ${googleResponse.status}`,
      };
    } catch (err) {
      results.external_connection = {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // Тест Supabase URL
    try {
      const supabaseResponse = await fetch(supabaseUrl);
      results.supabase_url = {
        status: 'success',
        message: `Supabase: ${supabaseResponse.status}`,
      };
    } catch (err) {
      results.supabase_url = {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // Тест таблиц через REST API
    const tables = ['flights', 'invoices', 'expenses'];

    for (const table of tables) {
      try {
        const url = `${supabaseUrl}/rest/v1/${table}?select=*&limit=1`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          results[table] = {
            status: 'success',
            count: data.length,
            sample: data[0] || null,
          };
        } else {
          const errorText = await response.text();
          results[table] = {
            status: 'error',
            code: response.status,
            message: errorText,
          };
        }
      } catch (err) {
        results[table] = {
          status: 'exception',
          message: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    res.json({
      timestamp: new Date().toISOString(),
      tests: results,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ---------- HTTPS to HTTP redirect ----------
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.header('x-forwarded-proto') === 'https' || req.secure) {
    const httpUrl = `http://${req.get('host')}${req.url}`;
    return res.redirect(301, httpUrl);
  }
  next();
});

// ---------- Routes ----------
app.get('/', (_req, res) => {
  res.render('dashboard/index', { title: 'Dashboard' });
});

app.get('/transactions', (_req, res) => {
  res.render('transactions/index', { title: 'Transactions' });
});

app.get('/invoices', (_req, res) => {
  res.render('invoices/index', { title: 'Invoices' });
});

app.get('/invoices/:id', async (req, res) => {
  try {
    const invoiceId = req.params.id;

    // Fetch invoice details from Supabase
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) {
      return res.status(404).render('error', {
        title: 'Invoice Not Found',
        message: 'The requested invoice could not be found.',
      });
    }

    res.render('invoices/details', {
      title: `${invoice.inv_number} details`,
      invoice: invoice,
    });
  } catch (error) {
    console.error('Error fetching invoice details:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred while loading the invoice details.',
    });
  }
});

app.get('/flights', (_req, res) => {
  res.render('flights/index', { title: 'Flights' });
});

app.get('/reports', (_req, res) => {
  res.render('reports/index', { title: 'Reports' });
});

app.get('/expenses', (_req, res) => {
  res.render('expenses/index', { title: 'Expenses' });
});

app.get('/disputes', (_req, res) => {
  res.render('disputes/index', { title: 'Disputes' });
});

// Settings route - simple version
app.get('/settings', (_req, res) => {
  res.render('settings/index', { title: 'Settings' });
});

// Create activity_logs table endpoint
app.post('/api/create-logs-table', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Try to create the table using raw SQL
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS activity_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(100) DEFAULT 'system',
        action VARCHAR(20) NOT NULL,
        table_name VARCHAR(50) NOT NULL,
        record_id UUID,
        record_details TEXT,
        old_data JSONB,
        new_data JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Try to execute the SQL
    const { error: createError } = await supabase.rpc('exec', {
      sql: createTableSQL,
    });

    if (createError) {
      console.log('Error creating table with rpc:', createError);

      // Try alternative approach - just test if table exists
      const { error: testError } = await supabase
        .from('activity_logs')
        .select('id')
        .limit(1);

      if (testError) {
        return res.status(500).json({
          error: 'Table does not exist and cannot be created via API',
          details: testError.message,
          instruction:
            'Please run the SQL script manually in Supabase dashboard',
        });
      }
    }

    // Create indexes
    const createIndexesSQL = `
      CREATE INDEX IF NOT EXISTS idx_activity_logs_table_name ON activity_logs(table_name);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_record_details ON activity_logs(record_details);
    `;

    await supabase.rpc('exec', { sql: createIndexesSQL });

    res.json({
      message: 'Activity logs table created successfully',
      tableExists: true,
    });
  } catch (error) {
    console.error('Error creating logs table:', error);
    res.status(500).json({
      error: 'Error creating table',
      details: error.message,
      instruction: 'Please run the SQL script manually in Supabase dashboard',
    });
  }
});

// Add record_details column endpoint
app.post('/api/add-record-details-column', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Try to add the column
    const addColumnSQL = `
      ALTER TABLE activity_logs 
      ADD COLUMN IF NOT EXISTS record_details TEXT;
    `;

    const { error: addColumnError } = await supabase.rpc('exec', {
      sql: addColumnSQL,
    });

    if (addColumnError) {
      console.log('Error adding column with rpc:', addColumnError);
      return res.status(500).json({
        error: 'Cannot add column via API',
        details: addColumnError.message,
        instruction: 'Please add the column manually in Supabase dashboard',
      });
    }

    // Create index for the new column
    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_activity_logs_record_details ON activity_logs(record_details);
    `;

    await supabase.rpc('exec', { sql: createIndexSQL });

    res.json({
      message: 'record_details column added successfully',
      columnAdded: true,
    });
  } catch (error) {
    console.error('Error adding column:', error);
    res.status(500).json({
      error: 'Error adding column',
      details: error.message,
      instruction: 'Please add the column manually in Supabase dashboard',
    });
  }
});

// Test logs table endpoint
app.get('/api/test-logs-table', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .limit(5);

    if (error) {
      return res.status(500).json({
        error: 'Table does not exist',
        details: error.message,
        instruction: 'Please create the table first',
      });
    }

    res.json({
      message: 'Table exists and is accessible',
      logs: data,
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('Error testing logs table:', error);
    res.status(500).json({ error: 'Error testing table' });
  }
});

// Logs route
app.get('/logs', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).render('logs/index', {
        title: 'Logs',
        logs: [],
        error: 'Database not available',
      });
    }

    const { data: logs, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error loading logs:', error);
    }

    res.render('logs/index', {
      title: 'Logs',
      logs: logs || [],
      error: null,
    });
  } catch (error) {
    console.error('Error loading logs page:', error);
    res.status(500).render('logs/index', {
      title: 'Logs',
      logs: [],
      error: 'Error loading logs',
    });
  }
});

// Маршрут для проверки соединения с Supabase
app.get('/api/health/supabase', async (_req, res) => {
  try {
    const isConnected = await testSupabaseConnection();

    // Дополнительные тесты если соединение работает
    let additionalTests: any = {};
    if (isConnected && supabase) {
      try {
        // Тест auth
        const { error: authError } = await supabase.auth.getSession();
        additionalTests.auth = authError
          ? `❌ ${authError.message}`
          : '✅ Auth service working';

        // Тест storage (если доступен)
        const { error: storageError } = await supabase.storage.listBuckets();
        additionalTests.storage = storageError
          ? `❌ ${storageError.message}`
          : '✅ Storage service working';

        // Тест таблиц
        const { data: flightsData, error: flightsError } = await supabase
          .from('flights')
          .select('*')
          .limit(1);
        additionalTests.flights = flightsError
          ? `❌ ${flightsError.message}`
          : `✅ Flights table accessible (${flightsData?.length || 0} records)`;

        const { data: invoicesData, error: invoicesError } = await supabase
          .from('invoices')
          .select('*')
          .limit(1);
        additionalTests.invoices = invoicesError
          ? `❌ ${invoicesError.message}`
          : `✅ Invoices table accessible (${invoicesData?.length || 0} records)`;

        const { data: expensesData, error: expensesError } = await supabase
          .from('expenses')
          .select('*')
          .limit(1);
        additionalTests.expenses = expensesError
          ? `❌ ${expensesError.message}`
          : `✅ Expenses table accessible (${expensesData?.length || 0} records)`;
      } catch (testError) {
        additionalTests.error =
          testError instanceof Error ? testError.message : 'Unknown test error';
      }
    }

    res.json({
      status: isConnected ? 'connected' : 'disconnected',
      supabase: isConnected ? '✅ Connected' : '❌ Disconnected',
      config: {
        url: process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing',
        key:
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
            ? '✅ Set'
            : '❌ Missing',
        keyType: process.env.SUPABASE_SERVICE_ROLE_KEY
          ? 'Service Role'
          : 'Anon',
      },
      services: additionalTests,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      supabase: '❌ Error',
      error: error instanceof Error ? error.message : 'Unknown error',
      config: {
        url: process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing',
        key:
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
            ? '✅ Set'
            : '❌ Missing',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// Mock data для fallback
const mockData = {
  flights: [
    {
      id: 1,
      flight_number: 'JF001',
      departure: 'JFK',
      arrival: 'LAX',
      departure_time: '2024-01-15T08:00:00Z',
      arrival_time: '2024-01-15T11:30:00Z',
      status: 'completed',
      revenue: 2500.0,
    },
    {
      id: 2,
      flight_number: 'JF002',
      departure: 'LAX',
      arrival: 'JFK',
      departure_time: '2024-01-15T14:00:00Z',
      arrival_time: '2024-01-15T22:30:00Z',
      status: 'completed',
      revenue: 2800.0,
    },
  ],
  invoices: [
    {
      id: 1,
      invoice_number: 'INV-2024-001',
      client: 'Business Travel Corp',
      amount: 15000.0,
      status: 'paid',
      due_date: '2024-01-20',
      created_at: '2024-01-10T10:00:00Z',
    },
    {
      id: 2,
      invoice_number: 'INV-2024-002',
      client: 'Corporate Airlines',
      amount: 22000.0,
      status: 'pending',
      due_date: '2024-01-25',
      created_at: '2024-01-12T14:30:00Z',
    },
  ],
  expenses: [
    {
      id: 1,
      category: 'Fuel',
      description: 'Jet fuel for JFK-LAX route',
      amount: 8500.0,
      date: '2024-01-15',
      status: 'approved',
    },
    {
      id: 2,
      category: 'Maintenance',
      description: 'Engine inspection and repair',
      amount: 12000.0,
      date: '2024-01-12',
      status: 'pending',
    },
  ],
};

// API маршруты
app.get('/api/flights', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('flights')
        .select('*')
        .order('flt_date', { ascending: false });

      if (error) {
        console.log('Supabase error, using mock data:', error.message);
        return res.json(mockData.flights);
      }

      return res.json(data || []);
    }

    res.json(mockData.flights);
  } catch (error) {
    console.log('Error fetching flights:', error);
    res.json(mockData.flights);
  }
});

// POST endpoint to add new flight
app.post('/api/flights', async (req, res) => {
  try {
    const { flt_date, flt_number, flt_dep, flt_arr, flt_time, flt_block } =
      req.body;

    // Validate required fields
    if (
      !flt_date ||
      !flt_number ||
      !flt_dep ||
      !flt_arr ||
      !flt_time ||
      !flt_block
    ) {
      return res.status(400).json({
        error:
          'All fields are required: flt_date, flt_number, flt_dep, flt_arr, flt_time, flt_block',
      });
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('flights')
        .insert([
          {
            flt_date,
            flt_number,
            flt_dep,
            flt_arr,
            flt_time,
            flt_block,
          },
        ])
        .select();

      if (error) {
        console.log('Supabase error adding flight:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to add flight to database' });
      }

      // Log the activity
      await logActivity(
        'CREATE',
        'flights',
        data[0].id,
        null,
        data[0],
        'system',
        req
      );

      return res.status(201).json({
        message: 'Flight added successfully',
        data: data[0],
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error adding flight:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/invoices', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('inv_date', { ascending: false });

      if (error) {
        console.log('Supabase error, using mock data:', error.message);
        return res.json(mockData.invoices);
      }

      return res.json(data || []);
    }

    res.json(mockData.invoices);
  } catch (error) {
    console.log('Error fetching invoices:', error);
    res.json(mockData.invoices);
  }
});

// GET endpoint to fetch expense types
app.get('/api/expense-types', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('expense_types')
        .select('*')
        .order('name');

      if (error) {
        console.log('Supabase error fetching expense types:', error.message);
        return res.status(500).json({ error: 'Failed to fetch expense types' });
      }

      return res.json(data || []);
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching expense types:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET endpoint to fetch expense subtypes by type
app.get('/api/expense-subtypes/:typeId', async (req, res) => {
  try {
    const typeId = req.params.typeId;

    if (supabase) {
      const { data, error } = await supabase
        .from('expense_subtypes')
        .select('*')
        .eq('expense_type_id', typeId)
        .order('name');

      if (error) {
        console.log('Supabase error fetching expense subtypes:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to fetch expense subtypes' });
      }

      return res.json(data || []);
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching expense subtypes:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET endpoint to fetch invoice types
app.get('/api/invoice-types', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('invoice_types')
        .select('*')
        .order('name');

      if (error) {
        console.log('Supabase error fetching invoice types:', error.message);
        return res.status(500).json({ error: 'Failed to fetch invoice types' });
      }

      return res.json(data || []);
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching invoice types:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== CRUD ENDPOINTS FOR DICTIONARIES ==========

// GET single expense type by ID
app.get('/api/expense-types/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      const { data, error } = await supabase
        .from('expense_types')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.log('Supabase error fetching expense type:', error.message);
        return res.status(500).json({ error: 'Failed to fetch expense type' });
      }

      return res.json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching expense type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create new expense type
app.post('/api/expense-types', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('expense_types')
        .insert([{ name, description: description || null }])
        .select()
        .single();

      if (error) {
        console.log('Supabase error creating expense type:', error.message);
        return res.status(500).json({ error: 'Failed to create expense type' });
      }

      // Log the activity
      await logActivity(
        'CREATE',
        'expense_types',
        data.id,
        null,
        data,
        'system',
        req
      );

      return res.status(201).json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error creating expense type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update expense type
app.put('/api/expense-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (supabase) {
      // First get the old data for logging
      const { data: oldData, error: fetchError } = await supabase
        .from('expense_types')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.log(
          'Supabase error fetching expense type:',
          fetchError.message
        );
        return res.status(404).json({ error: 'Expense type not found' });
      }

      const { data, error } = await supabase
        .from('expense_types')
        .update({
          name,
          description: description || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.log('Supabase error updating expense type:', error.message);
        return res.status(500).json({ error: 'Failed to update expense type' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'expense_types',
        id,
        oldData,
        data,
        'system',
        req
      );

      return res.json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error updating expense type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE expense type
app.delete('/api/expense-types/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      // First get the expense type data for logging
      const { data: expenseType, error: fetchError } = await supabase
        .from('expense_types')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.log(
          'Supabase error fetching expense type:',
          fetchError.message
        );
        return res.status(404).json({ error: 'Expense type not found' });
      }

      // First delete all associated subtypes
      const { error: subtypesError } = await supabase
        .from('expense_subtypes')
        .delete()
        .eq('expense_type_id', id);

      if (subtypesError) {
        console.log(
          'Supabase error deleting expense subtypes:',
          subtypesError.message
        );
        return res
          .status(500)
          .json({ error: 'Failed to delete associated subtypes' });
      }

      // Then delete the expense type
      const { error } = await supabase
        .from('expense_types')
        .delete()
        .eq('id', id);

      if (error) {
        console.log('Supabase error deleting expense type:', error.message);
        return res.status(500).json({ error: 'Failed to delete expense type' });
      }

      // Log the activity
      await logActivity(
        'DELETE',
        'expense_types',
        id,
        expenseType,
        null,
        'system',
        req
      );

      return res.status(204).send();
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error deleting expense type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single expense subtype by ID
app.get('/api/expense-subtypes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      const { data, error } = await supabase
        .from('expense_subtypes')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.log('Supabase error fetching expense subtype:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to fetch expense subtype' });
      }

      return res.json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching expense subtype:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create new expense subtype
app.post('/api/expense-subtypes', async (req, res) => {
  try {
    const { name, description, expense_type_id } = req.body;

    if (!name || !expense_type_id) {
      return res
        .status(400)
        .json({ error: 'Name and expense_type_id are required' });
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('expense_subtypes')
        .insert([{ name, description: description || null, expense_type_id }])
        .select()
        .single();

      if (error) {
        console.log('Supabase error creating expense subtype:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to create expense subtype' });
      }

      // Log the activity
      await logActivity(
        'CREATE',
        'expense_subtypes',
        data.id,
        null,
        data,
        'system',
        req
      );

      return res.status(201).json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error creating expense subtype:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update expense subtype
app.put('/api/expense-subtypes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, expense_type_id } = req.body;

    if (!name || !expense_type_id) {
      return res
        .status(400)
        .json({ error: 'Name and expense_type_id are required' });
    }

    if (supabase) {
      // First get the old data for logging
      const { data: oldData, error: fetchError } = await supabase
        .from('expense_subtypes')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.log(
          'Supabase error fetching expense subtype:',
          fetchError.message
        );
        return res.status(404).json({ error: 'Expense subtype not found' });
      }

      const { data, error } = await supabase
        .from('expense_subtypes')
        .update({
          name,
          description: description || null,
          expense_type_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.log('Supabase error updating expense subtype:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to update expense subtype' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'expense_subtypes',
        id,
        oldData,
        data,
        'system',
        req
      );

      return res.json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error updating expense subtype:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE expense subtype
app.delete('/api/expense-subtypes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      // First get the expense subtype data for logging
      const { data: expenseSubtype, error: fetchError } = await supabase
        .from('expense_subtypes')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.log(
          'Supabase error fetching expense subtype:',
          fetchError.message
        );
        return res.status(404).json({ error: 'Expense subtype not found' });
      }

      const { error } = await supabase
        .from('expense_subtypes')
        .delete()
        .eq('id', id);

      if (error) {
        console.log('Supabase error deleting expense subtype:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to delete expense subtype' });
      }

      // Log the activity
      await logActivity(
        'DELETE',
        'expense_subtypes',
        id,
        expenseSubtype,
        null,
        'system',
        req
      );

      return res.status(204).send();
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error deleting expense subtype:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single invoice type by ID
app.get('/api/invoice-types/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      const { data, error } = await supabase
        .from('invoice_types')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.log('Supabase error fetching invoice type:', error.message);
        return res.status(500).json({ error: 'Failed to fetch invoice type' });
      }

      return res.json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching invoice type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create new invoice type
app.post('/api/invoice-types', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('invoice_types')
        .insert([{ name, description: description || null }])
        .select()
        .single();

      if (error) {
        console.log('Supabase error creating invoice type:', error.message);
        return res.status(500).json({ error: 'Failed to create invoice type' });
      }

      // Log the activity
      await logActivity(
        'CREATE',
        'invoice_types',
        data.id,
        null,
        data,
        'system',
        req
      );

      return res.status(201).json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error creating invoice type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update invoice type
app.put('/api/invoice-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (supabase) {
      // First get the old data for logging
      const { data: oldData, error: fetchError } = await supabase
        .from('invoice_types')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.log(
          'Supabase error fetching invoice type:',
          fetchError.message
        );
        return res.status(404).json({ error: 'Invoice type not found' });
      }

      const { data, error } = await supabase
        .from('invoice_types')
        .update({
          name,
          description: description || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.log('Supabase error updating invoice type:', error.message);
        return res.status(500).json({ error: 'Failed to update invoice type' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'invoice_types',
        id,
        oldData,
        data,
        'system',
        req
      );

      return res.json(data);
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error updating invoice type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE invoice type
app.delete('/api/invoice-types/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      // First get the invoice type data for logging
      const { data: invoiceType, error: fetchError } = await supabase
        .from('invoice_types')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) {
        console.log(
          'Supabase error fetching invoice type:',
          fetchError.message
        );
        return res.status(404).json({ error: 'Invoice type not found' });
      }

      const { error } = await supabase
        .from('invoice_types')
        .delete()
        .eq('id', id);

      if (error) {
        console.log('Supabase error deleting invoice type:', error.message);
        return res.status(500).json({ error: 'Failed to delete invoice type' });
      }

      // Log the activity
      await logActivity(
        'DELETE',
        'invoice_types',
        id,
        invoiceType,
        null,
        'system',
        req
      );

      return res.status(204).send();
    }

    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error deleting invoice type:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/expenses', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('expenses')
        .select(
          `
          *,
          invoices!exp_invoice (
            inv_number
          ),
          flights!exp_flight (
            flt_number
          )
        `
        )
        .order('id', { ascending: false });

      if (error) {
        console.log('Supabase error, using mock data:', error.message);
        return res.json(mockData.expenses);
      }

      return res.json(data || []);
    }

    res.json(mockData.expenses);
  } catch (error) {
    console.log('Error fetching expenses:', error);
    res.json(mockData.expenses);
  }
});

app.get('/api/invoices/:id/expenses', async (req, res) => {
  try {
    const invoiceId = req.params.id;

    if (supabase) {
      const { data, error } = await supabase
        .from('expenses')
        .select(
          `
          *,
          invoices!exp_invoice (
            inv_number
          ),
          flights!exp_flight (
            flt_number
          )
        `
        )
        .eq('exp_invoice', invoiceId)
        .order('exp_invoice_type', { ascending: true });

      if (error) {
        console.log('Supabase error fetching invoice expenses:', error.message);
        return res.status(500).json({ error: 'Failed to fetch expenses' });
      }

      return res.json(data || []);
    }

    res.status(500).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching invoice expenses:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST endpoint to add new invoice
app.post('/api/invoices', async (req, res) => {
  try {
    const { inv_date, inv_number, inv_amount, inv_currency } = req.body;

    // Validate required fields
    if (!inv_date || !inv_number || !inv_amount || !inv_currency) {
      return res.status(400).json({
        error:
          'All fields are required: inv_date, inv_number, inv_amount, inv_currency',
      });
    }

    // Validate currency
    const validCurrencies = ['AED', 'USD', 'EUR'];
    if (!validCurrencies.includes(inv_currency)) {
      return res.status(400).json({
        error: 'Invalid currency. Must be one of: AED, USD, EUR',
      });
    }

    // Validate amount
    const amount = parseFloat(inv_amount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        error: 'Amount must be a positive number',
      });
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('invoices')
        .insert([
          {
            inv_date,
            inv_number,
            inv_amount: amount,
            inv_currency,
            inv_tags: '', // Empty for now as requested
          },
        ])
        .select();

      if (error) {
        console.log('Supabase error adding invoice:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to add invoice to database' });
      }

      // Log the activity
      await logActivity(
        'CREATE',
        'invoices',
        data[0].id,
        null,
        data[0],
        'system',
        req
      );

      return res.status(201).json({
        message: 'Invoice added successfully',
        data: data[0],
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error adding invoice:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// DELETE endpoint to remove invoice
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const invoiceId = req.params.id;

    if (!invoiceId) {
      return res.status(400).json({
        error: 'Invoice ID is required',
      });
    }

    if (supabase) {
      // First get the invoice data for logging
      const { data: invoice, error: fetchError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (fetchError) {
        console.log('Supabase error fetching invoice:', fetchError.message);
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId);

      if (error) {
        console.log('Supabase error deleting invoice:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to delete invoice from database' });
      }

      // Log the activity
      await logActivity(
        'DELETE',
        'invoices',
        invoiceId,
        invoice,
        null,
        'system',
        req
      );

      return res.status(200).json({
        message: 'Invoice deleted successfully',
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error deleting invoice:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// DELETE endpoint to remove flight
app.delete('/api/flights/:id', async (req, res) => {
  try {
    const flightId = req.params.id;

    if (!flightId) {
      return res.status(400).json({
        error: 'Flight ID is required',
      });
    }

    if (supabase) {
      // First get the flight data for logging
      const { data: flight, error: fetchError } = await supabase
        .from('flights')
        .select('*')
        .eq('id', flightId)
        .single();

      if (fetchError) {
        console.log('Supabase error fetching flight:', fetchError.message);
        return res.status(404).json({ error: 'Flight not found' });
      }

      const { error } = await supabase
        .from('flights')
        .delete()
        .eq('id', flightId);

      if (error) {
        console.log('Supabase error deleting flight:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to delete flight from database' });
      }

      // Log the activity
      await logActivity(
        'DELETE',
        'flights',
        flightId,
        flight,
        null,
        'system',
        req
      );

      return res.status(200).json({
        message: 'Flight deleted successfully',
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error deleting flight:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// POST endpoint to add new expense
app.post('/api/expenses', async (req, res) => {
  try {
    const {
      exp_type,
      exp_place,
      exp_amount,
      exp_period_start,
      exp_period_end,
      exp_fuel_quan,
      exp_fuel_provider,
      exp_invoice_type,
      exp_invoice,
      exp_flight,
      exp_comments,
      exp_currency,
      exp_subtype,
    } = req.body;

    // Get type and subtype names from IDs
    let expTypeName = null;
    let expSubtypeName = null;
    let expInvoiceTypeName = null;

    if (exp_type && supabase) {
      const { data: typeData } = await supabase
        .from('expense_types')
        .select('name')
        .eq('id', exp_type)
        .single();
      expTypeName = typeData?.name || null;
    }

    if (exp_subtype && supabase) {
      const { data: subtypeData } = await supabase
        .from('expense_subtypes')
        .select('name')
        .eq('id', exp_subtype)
        .single();
      expSubtypeName = subtypeData?.name || null;
    }

    if (exp_invoice_type && supabase) {
      const { data: invoiceTypeData } = await supabase
        .from('invoice_types')
        .select('name')
        .eq('id', exp_invoice_type)
        .single();
      expInvoiceTypeName = invoiceTypeData?.name || null;
    }

    // Validate required fields (all are optional according to requirements)
    // But we'll validate data types if provided

    if (exp_amount && isNaN(parseFloat(exp_amount))) {
      return res.status(400).json({
        error: 'Amount must be a valid number',
      });
    }

    if (exp_fuel_quan && isNaN(parseFloat(exp_fuel_quan))) {
      return res.status(400).json({
        error: 'Fuel quantity must be a valid number',
      });
    }

    // Validate period dates
    if (exp_period_start && exp_period_start.trim() !== '') {
      const periodStartDate =
        exp_period_start.includes('-') && exp_period_start.length === 7
          ? `${exp_period_start}-01`
          : exp_period_start;

      if (isNaN(Date.parse(periodStartDate))) {
        return res.status(400).json({
          error: 'Invalid period start date format',
        });
      }
    }

    if (exp_period_end && exp_period_end.trim() !== '') {
      const periodEndDate =
        exp_period_end.includes('-') && exp_period_end.length === 7
          ? `${exp_period_end}-01`
          : exp_period_end;

      if (isNaN(Date.parse(periodEndDate))) {
        return res.status(400).json({
          error: 'Invalid period end date format',
        });
      }
    }

    if (supabase) {
      const expenseData = {
        exp_type: expTypeName || null,
        exp_place: exp_place || null,
        exp_amount: exp_amount ? parseFloat(exp_amount) : null,
        exp_period_start:
          exp_period_start && exp_period_start.trim() !== ''
            ? exp_period_start.includes('-') && exp_period_start.length === 7
              ? `${exp_period_start}-01`
              : exp_period_start
            : null,
        exp_period_end:
          exp_period_end && exp_period_end.trim() !== ''
            ? exp_period_end.includes('-') && exp_period_end.length === 7
              ? `${exp_period_end}-01`
              : exp_period_end
            : null,
        exp_fuel_quan: exp_fuel_quan ? parseFloat(exp_fuel_quan) : null,
        exp_fuel_provider: exp_fuel_provider || null,
        exp_invoice_type: expInvoiceTypeName || null,
        exp_invoice: exp_invoice || null,
        exp_flight: exp_flight || null,
        exp_comments: exp_comments || null,
        exp_currency: exp_currency || null,
        exp_subtype: expSubtypeName || null,
      };

      const { data, error } = await supabase
        .from('expenses')
        .insert([expenseData])
        .select();

      if (error) {
        console.log('Supabase error adding expense:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to add expense to database' });
      }

      // Log the activity
      await logActivity(
        'CREATE',
        'expenses',
        data[0].id,
        null,
        data[0],
        'system',
        req
      );

      return res.status(201).json({
        message: 'Expense added successfully',
        data: data[0],
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error adding expense:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

app.get('/api/dashboard/stats', async (_req, res) => {
  try {
    let stats = {
      total_revenue: 0,
      total_expenses: 0,
      flights_count: 0,
      invoices_pending: 0,
    };

    if (supabase) {
      try {
        // Получаем статистику из базы данных
        const [flightsResult, invoicesResult, expensesResult] =
          await Promise.all([
            supabase.from('flights').select('revenue'),
            supabase.from('invoices').select('amount, status'),
            supabase.from('expenses').select('amount'),
          ]);

        if (!flightsResult.error) {
          stats.flights_count = flightsResult.data?.length || 0;
          stats.total_revenue =
            flightsResult.data?.reduce(
              (sum, flight) => sum + (flight.revenue || 0),
              0
            ) || 0;
        }

        if (!invoicesResult.error) {
          stats.invoices_pending =
            invoicesResult.data?.filter(inv => inv.status === 'pending')
              .length || 0;
        }

        if (!expensesResult.error) {
          stats.total_expenses =
            expensesResult.data?.reduce(
              (sum, expense) => sum + (expense.amount || 0),
              0
            ) || 0;
        }
      } catch (dbError) {
        console.log('Database error, using mock stats:', dbError);
        // Используем mock данные
        stats = {
          total_revenue: 5300,
          total_expenses: 20500,
          flights_count: 2,
          invoices_pending: 1,
        };
      }
    } else {
      // Mock статистика
      stats = {
        total_revenue: 5300,
        total_expenses: 20500,
        flights_count: 2,
        invoices_pending: 1,
      };
    }

    res.json(stats);
  } catch (error) {
    console.log('Error fetching dashboard stats:', error);
    res.json({
      total_revenue: 5300,
      total_expenses: 20500,
      flights_count: 2,
      invoices_pending: 1,
    });
  }
});

// 404
app.use((_req, res) => {
  res.status(404).render('dashboard/index', { title: 'Not Found' });
});

// Ошибки
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).render('dashboard/index', { title: 'Server Error' });
});

// ---------- Start ----------
app.listen(PORT, async () => {
  console.log(`🚀 Jet Finances running at http://localhost:${PORT}`);
  console.log(
    `📊 Health check available at http://localhost:${PORT}/api/health/supabase`
  );

  // Тестируем соединение с Supabase при запуске
  await testSupabaseConnection();
});
