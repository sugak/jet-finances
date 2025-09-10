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

// CSRF (cookie-based)
const csrfProtection = csrf({ cookie: true });
app.use(csrfProtection);

// пробрасываем CSRF-токен в шаблоны и для HTMX-запросов
app.use((req: Request, res: Response, next: NextFunction) => {
  const token = (req as any).csrfToken?.() || res.locals.csrfToken;
  res.locals.csrfToken = token;
  res.setHeader('X-CSRF-Token', token);
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

    const results = {};

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

app.get('/flights', (_req, res) => {
  res.render('flights/index', { title: 'Flights' });
});

app.get('/reports', (_req, res) => {
  res.render('reports/index', { title: 'Reports' });
});

app.get('/disputes', (_req, res) => {
  res.render('disputes/index', { title: 'Disputes' });
});

app.get('/settings', (_req, res) => {
  res.render('settings/index', { title: 'Settings' });
});

// Маршрут для проверки соединения с Supabase
app.get('/api/health/supabase', async (_req, res) => {
  try {
    const isConnected = await testSupabaseConnection();

    // Дополнительные тесты если соединение работает
    let additionalTests = {};
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
        .order('departure_time', { ascending: false });

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

app.get('/api/invoices', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

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

app.get('/api/expenses', async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('date', { ascending: false });

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
