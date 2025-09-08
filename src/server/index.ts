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
