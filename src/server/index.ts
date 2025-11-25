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
import * as XLSX from 'xlsx';

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

// ---------- Authentication Types ----------
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'superadmin' | 'reader';
    full_name?: string;
  };
}

// interface JWTPayload { // Not used in current implementation
//   sub: string;
//   email: string;
//   aud: string;
//   role: string;
//   iat: number;
//   exp: number;
// }

// Helper function to get next month for single month periods
function getNextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (month === 12) {
    return `${year + 1}-01`;
  } else {
    return `${year}-${(month + 1).toString().padStart(2, '0')}`;
  }
}

// Helper function to sort flights logically (building flight chains)
function sortFlightsLogically(flights: any[]): any[] {
  if (!flights || flights.length === 0) return flights;

  // First, sort by date (oldest first)
  const sortedByDate = [...flights].sort(
    (a, b) => new Date(a.flt_date).getTime() - new Date(b.flt_date).getTime()
  );

  // Group flights by date
  const flightsByDate: { [date: string]: any[] } = {};
  sortedByDate.forEach(flight => {
    const date = flight.flt_date;
    if (!flightsByDate[date]) {
      flightsByDate[date] = [];
    }
    flightsByDate[date].push(flight);
  });

  // Sort flights within each date to create logical chains
  const result: any[] = [];
  const sortedDates = Object.keys(flightsByDate).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  sortedDates.forEach(date => {
    const dayFlights = flightsByDate[date];
    const sortedDayFlights = sortFlightsWithinDay(dayFlights);
    result.push(...sortedDayFlights);
  });

  return result;
}

// Helper function to sort flights within a single day to create logical chains
function sortFlightsWithinDay(flights: any[]): any[] {
  if (flights.length <= 1) return flights;

  const result: any[] = [];
  const remaining = [...flights];

  // Start with the first flight
  let currentFlight = remaining.shift();
  result.push(currentFlight);

  // Build the chain by finding the next flight that starts where the current one ends
  while (remaining.length > 0) {
    const currentArrival = currentFlight.flt_arr;

    // Find a flight that starts from the current arrival airport
    const nextFlightIndex = remaining.findIndex(
      flight => flight.flt_dep === currentArrival
    );

    if (nextFlightIndex !== -1) {
      // Found a connecting flight
      currentFlight = remaining.splice(nextFlightIndex, 1)[0];
      result.push(currentFlight);
    } else {
      // No connecting flight found, start a new chain
      currentFlight = remaining.shift();
      result.push(currentFlight);
    }
  }

  return result;
}

// ---------- Authentication Middleware ----------
async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Verify JWT token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Get user role from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return res.status(403).json({ error: 'User not found' });
    }

    req.user = {
      id: user.id,
      email: user.email || '',
      role: userData.role as 'superadmin' | 'reader',
      full_name: userData.full_name,
    };

    next();
  } catch (error) {
    console.log('Authentication error:', error);
    return res.status(403).json({ error: 'Authentication failed' });
  }
}

// Middleware to check if user is superadmin
function requireSuperadmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}

// Middleware for session-based authentication (for EJS pages)
async function authenticateSession(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const sessionToken =
      req.cookies['sb-access-token'] || req.cookies['supabase-auth-token'];
    const refreshToken = req.cookies['sb-refresh-token'];

    if (!sessionToken) {
      return res.redirect('/login');
    }

    if (!supabase) {
      return res.status(500).render('error', {
        title: 'Error',
        error: 'Database not available',
      });
    }

    // Verify session token
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(sessionToken);

    // If token is invalid/expired, try to refresh it
    if ((error || !user) && refreshToken) {
      console.log('Access token expired, attempting refresh...');
      try {
        const { data: refreshData, error: refreshError } =
          await supabase.auth.refreshSession({
            refresh_token: refreshToken,
          });

        if (refreshError || !refreshData.session) {
          console.log('Token refresh failed:', refreshError?.message);
          // Clear invalid cookies and redirect to login
          res.clearCookie('sb-access-token');
          res.clearCookie('sb-refresh-token');
          res.clearCookie('supabase-auth-token');
          return res.redirect('/login');
        }

        // Set new tokens in cookies
        const cookieOptions = {
          maxAge: 24 * 60 * 60 * 1000, // 1 day
          httpOnly: false, // Allow JavaScript to read the access token
          secure: process.env.NODE_ENV === 'production',
          sameSite: (process.env.NODE_ENV === 'production'
            ? 'none'
            : 'strict') as 'none' | 'strict',
          path: '/',
        };

        res.cookie(
          'sb-access-token',
          refreshData.session.access_token,
          cookieOptions
        );

        if (refreshData.session.refresh_token) {
          res.cookie('sb-refresh-token', refreshData.session.refresh_token, {
            ...cookieOptions,
            httpOnly: true, // Refresh token should be httpOnly
          });
        }

        console.log('Token refreshed successfully');
        // Use the new user data
        const newUser = refreshData.user;

        if (!newUser) {
          res.clearCookie('sb-access-token');
          res.clearCookie('sb-refresh-token');
          res.clearCookie('supabase-auth-token');
          return res.redirect('/login');
        }

        // Get user role from database
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('role, full_name')
          .eq('id', newUser.id)
          .single();

        if (userError || !userData) {
          res.clearCookie('sb-access-token');
          res.clearCookie('sb-refresh-token');
          res.clearCookie('supabase-auth-token');
          return res.redirect('/login');
        }

        // Add user info to response locals for EJS templates
        res.locals.user = {
          id: newUser.id,
          email: newUser.email || '',
          role: userData.role as 'superadmin' | 'reader',
          full_name: userData.full_name,
        };

        return next();
      } catch (refreshError) {
        console.log('Token refresh exception:', refreshError);
        res.clearCookie('sb-access-token');
        res.clearCookie('sb-refresh-token');
        res.clearCookie('supabase-auth-token');
        return res.redirect('/login');
      }
    }

    // If no refresh token or refresh failed, check original token
    if (error || !user) {
      res.clearCookie('sb-access-token');
      res.clearCookie('sb-refresh-token');
      res.clearCookie('supabase-auth-token');
      return res.redirect('/login');
    }

    // Get user role from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      res.clearCookie('sb-access-token');
      res.clearCookie('sb-refresh-token');
      res.clearCookie('supabase-auth-token');
      return res.redirect('/login');
    }

    // Add user info to response locals for EJS templates
    res.locals.user = {
      id: user.id,
      email: user.email || '',
      role: userData.role as 'superadmin' | 'reader',
      full_name: userData.full_name,
    };

    next();
  } catch (error) {
    console.log('Session authentication error:', error);
    res.clearCookie('sb-access-token');
    res.clearCookie('sb-refresh-token');
    res.clearCookie('supabase-auth-token');
    return res.redirect('/login');
  }
}

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
        'connect-src': [
          "'self'",
          supabaseUrl || 'https://qrmsxfmxnucjgglodjyb.supabase.co',
          supabaseUrl?.replace('https://', 'wss://') ||
            'wss://qrmsxfmxnucjgglodjyb.supabase.co',
          'https://cdn.jsdelivr.net', // Allow source maps
        ],
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

// ---------- Trust proxy for Railway ----------
app.set('trust proxy', 1);

// ---------- HTTPS redirect (only in production) ----------
if (process.env.NODE_ENV === 'production') {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      const httpsUrl = `https://${req.get('host')}${req.url}`;
      return res.redirect(301, httpsUrl);
    }
    next();
  });
}

// ---------- Routes ----------
// ---------- Authentication Routes ----------
app.get('/login', (_req, res) => {
  res.render('auth/login', {
    title: 'Login',
    process: { env: process.env },
    layout: false, // Отключаем layout для страницы логина
  });
});

// Диагностическая страница для проверки переменных окружения
app.get('/debug-env', (_req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'NOT SET',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT SET',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? 'SET'
      : 'NOT SET',
    SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    // Показываем первые 20 символов для проверки
    SUPABASE_URL_PREVIEW: process.env.SUPABASE_URL?.substring(0, 30) + '...',
    SUPABASE_ANON_KEY_PREVIEW:
      process.env.SUPABASE_ANON_KEY?.substring(0, 30) + '...',
  });
});

// Диагностический endpoint для проверки аутентификации
app.get('/debug-auth', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.json({
        status: 'no_token',
        message: 'No authorization token provided',
        cookies: req.headers.cookie,
      });
    }

    if (!supabase) {
      return res.json({
        status: 'no_supabase',
        message: 'Supabase not available',
      });
    }

    // Проверяем токен
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.json({
        status: 'invalid_token',
        message: 'Invalid or expired token',
        error: error?.message,
      });
    }

    // Проверяем пользователя в таблице users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return res.json({
        status: 'user_not_found',
        message: 'User not found in users table',
        userId: user.id,
        userEmail: user.email,
        error: userError?.message,
      });
    }

    return res.json({
      status: 'success',
      user: {
        id: user.id,
        email: user.email,
        role: userData.role,
        full_name: userData.full_name,
      },
    });
  } catch (error) {
    return res.json({
      status: 'error',
      message: 'Authentication check failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Прокси для обхода CORS - временное решение
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    console.log('Server-side login attempt for:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Login error:', error);
      return res.status(401).json({ error: error.message });
    }

    if (data.user && data.session) {
      // Set session cookies with proper production settings
      const cookieOptions = {
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        httpOnly: false, // Allow JavaScript to read the token
        secure: process.env.NODE_ENV === 'production',
        sameSite: (process.env.NODE_ENV === 'production'
          ? 'none'
          : 'strict') as 'none' | 'strict', // 'none' for cross-site in production
        domain: process.env.NODE_ENV === 'production' ? undefined : undefined, // Let browser handle domain
        path: '/',
      };

      res.cookie('sb-access-token', data.session.access_token, cookieOptions);

      // Also store refresh token for session renewal
      if (data.session.refresh_token) {
        res.cookie('sb-refresh-token', data.session.refresh_token, {
          ...cookieOptions,
          httpOnly: true, // Refresh token should be httpOnly for security
        });
      }

      return res.json({
        success: true,
        user: data.user,
        redirect: '/',
      });
    }

    return res.status(401).json({ error: 'Login failed: invalid session' });
  } catch (error) {
    console.error('Server login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Check session status endpoint
app.get('/api/auth/status', async (req, res) => {
  try {
    const sessionToken = req.cookies['sb-access-token'];

    if (!sessionToken || !supabase) {
      return res.json({ authenticated: false });
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(sessionToken);

    if (error || !user) {
      return res.json({ authenticated: false });
    }

    // Get user role from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        role: userData.role,
        full_name: userData.full_name,
      },
    });
  } catch (error) {
    console.error('Session status check error:', error);
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    // Get the access token from cookie
    const accessToken = req.cookies['sb-access-token'];

    // If we have a token and supabase client, sign out from Supabase
    if (accessToken && supabase) {
      try {
        await supabase.auth.signOut();
        console.log('Successfully signed out from Supabase');
      } catch (error) {
        console.warn('Supabase signOut error (non-critical):', error);
        // Continue with cookie cleanup even if Supabase signOut fails
      }
    }

    // Clear all session cookies with proper options
    const cookieOptions = {
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? undefined : undefined,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'strict') as
        | 'none'
        | 'strict',
    };

    res.clearCookie('sb-access-token', cookieOptions);
    res.clearCookie('sb-refresh-token', cookieOptions);
    res.clearCookie('supabase-auth-token', cookieOptions);

    console.log('Session cookies cleared');
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    // Still clear cookies even if there's an error
    res.clearCookie('sb-access-token');
    res.clearCookie('sb-refresh-token');
    res.clearCookie('supabase-auth-token');
    res.json({ success: true });
  }
});

// ---------- Protected Routes ----------
app.get('/', authenticateSession, (_req, res) => {
  res.redirect('/flights');
});

app.get('/transactions', (_req, res) => {
  res.render('transactions/index', { title: 'Transactions' });
});

app.get('/invoices', authenticateSession, (_req, res) => {
  res.render('invoices/index', { title: 'Invoices' });
});

app.get('/invoices/:id', authenticateSession, async (req, res) => {
  try {
    const invoiceId = req.params.id;

    // Fetch invoice details from Supabase
    if (!supabase) {
      return res.status(500).render('error', {
        title: 'Database Error',
        message: 'Database connection not available.',
      });
    }

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

app.get('/flights', authenticateSession, (_req, res) => {
  res.render('flights/index', { title: 'Flights' });
});

app.get('/flights/expenses', authenticateSession, (_req, res) => {
  res.render('flights/expenses', { title: 'Flight Expenses' });
});

app.get(
  '/flights/:flightNumber/expenses',
  authenticateSession,
  async (req, res) => {
    try {
      const flightNumber = decodeURIComponent(req.params.flightNumber);

      if (!supabase) {
        return res.status(500).render('error', {
          title: 'Database Error',
          message: 'Database connection not available.',
        });
      }

      // Fetch first flight with this number to get basic info
      const { data: flights, error: flightsError } = await supabase
        .from('flights')
        .select('*')
        .eq('flt_number', flightNumber)
        .limit(1);

      if (flightsError || !flights || flights.length === 0) {
        return res.status(404).render('error', {
          title: 'Flight Not Found',
          message: `Flight ${flightNumber} could not be found.`,
        });
      }

      // Use first flight for display info
      const flight = flights[0];

      res.render('flights/expense-details', {
        title: `Flight ${flight.flt_number} Expenses`,
        flight: { ...flight, flt_number: flightNumber },
      });
    } catch (error) {
      console.error('Error fetching flight details:', error);
      res.status(500).render('error', {
        title: 'Error',
        message: 'An error occurred while loading the flight details.',
      });
    }
  }
);

app.get('/expenses', authenticateSession, (_req, res) => {
  res.render('expenses/index', { title: 'Expenses' });
});

app.get('/expenses/report', authenticateSession, (_req, res) => {
  res.render('expenses/report', { title: 'Expenses Report' });
});

// Settings route - simple version
app.get('/settings', authenticateSession, (_req, res) => {
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
      details: error instanceof Error ? error.message : 'Unknown error',
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
      details: error instanceof Error ? error.message : 'Unknown error',
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
        months: [],
        selectedPeriod: null,
      });
    }

    const { data: monthsRaw, error: monthsError } = await supabase
      .from('activity_logs')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (monthsError) {
      console.error('Error fetching log periods:', monthsError);
    }

    const months: { key: string; label: string }[] = [];
    const seenMonths = new Set<string>();
    const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
      month: 'long',
      year: 'numeric',
    });

    if (monthsRaw) {
      monthsRaw.forEach(entry => {
        if (!entry.created_at) {
          return;
        }

        const date = new Date(entry.created_at as string);
        if (Number.isNaN(date.getTime())) {
          return;
        }

        const key = `${date.getFullYear()}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, '0')}`;

        if (!seenMonths.has(key)) {
          seenMonths.add(key);
          months.push({ key, label: dateFormatter.format(date) });
        }
      });
    }

    const requestedPeriod =
      typeof req.query.period === 'string' &&
      /^\d{4}-\d{2}$/.test(req.query.period)
        ? req.query.period
        : null;

    let selectedPeriod = requestedPeriod;

    if (!selectedPeriod) {
      selectedPeriod = months.length > 0 ? months[0].key : null;
    }

    if (
      selectedPeriod &&
      !months.some(month => month.key === selectedPeriod) &&
      /^\d{4}-\d{2}$/.test(selectedPeriod)
    ) {
      const [yearStr, monthStr] = selectedPeriod.split('-');
      const year = Number.parseInt(yearStr, 10);
      const monthIndex = Number.parseInt(monthStr, 10) - 1;

      if (Number.isFinite(year) && Number.isFinite(monthIndex)) {
        const customDate = new Date(Date.UTC(year, monthIndex, 1));
        months.push({
          key: selectedPeriod,
          label: dateFormatter.format(customDate),
        });
      }
    }

    if (months.length > 1) {
      // Сортируем месяцы по убыванию (новые первыми)
      months.sort((a, b) => {
        if (a.key < b.key) return 1;
        if (a.key > b.key) return -1;
        return 0;
      });
    }

    let logs: any[] = [];

    if (selectedPeriod) {
      const [yearStr, monthStr] = selectedPeriod.split('-');
      const year = Number.parseInt(yearStr, 10);
      const monthIndex = Number.parseInt(monthStr, 10) - 1;

      if (Number.isFinite(year) && Number.isFinite(monthIndex)) {
        // Создаем даты в UTC для начала и конца месяца
        // Начало месяца: 1-е число в 00:00:00 UTC
        const startDate = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
        // Конец месяца: 1-е число следующего месяца в 00:00:00 UTC
        const endDate = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));

        // Форматируем даты для Supabase (ISO формат)
        const startDateISO = startDate.toISOString();
        const endDateISO = endDate.toISOString();

        console.log('Filtering logs for period:', {
          selectedPeriod,
          year,
          monthIndex: monthIndex + 1,
          startDate: startDateISO,
          endDate: endDateISO,
        });

        // Используем строковое сравнение для фильтрации по дате
        // Формат: YYYY-MM-DD для начала месяца и YYYY-MM-DD для конца месяца
        const startDateStr = `${year}-${(monthIndex + 1).toString().padStart(2, '0')}-01`;
        const endDateStr =
          monthIndex === 11
            ? `${year + 1}-01-01`
            : `${year}-${(monthIndex + 2).toString().padStart(2, '0')}-01`;

        console.log('Using date string filtering:', {
          startDateStr,
          endDateStr,
          startDateISO,
          endDateISO,
        });

        // Пробуем оба способа фильтрации
        let query = supabase
          .from('activity_logs')
          .select('*')
          .order('created_at', { ascending: false });

        // Используем ISO формат для фильтрации
        query = query
          .gte('created_at', startDateISO)
          .lt('created_at', endDateISO);

        const { data: logsData, error: logsError } = await query;

        if (logsError) {
          console.error('Error loading logs:', logsError);
          console.error('Error details:', logsError);
        } else {
          console.log(
            `Loaded ${logsData?.length || 0} logs for period ${selectedPeriod}`
          );
        }

        logs = logsData || [];
      }
    }

    res.render('logs/index', {
      title: 'Logs',
      logs,
      error: null,
      months,
      selectedPeriod,
    });
  } catch (error) {
    console.error('Error loading logs page:', error);
    res.status(500).render('logs/index', {
      title: 'Logs',
      logs: [],
      error: 'Error loading logs',
      months: [],
      selectedPeriod: null,
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
app.get('/api/flights', authenticateToken, async (_req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('flights').select('*');

      if (error) {
        console.log('Supabase error, using mock data:', error.message);
        return res.json(sortFlightsLogically(mockData.flights));
      }

      return res.json(sortFlightsLogically(data || []));
    }

    res.json(sortFlightsLogically(mockData.flights));
  } catch (error) {
    console.log('Error fetching flights:', error);
    res.json(sortFlightsLogically(mockData.flights));
  }
});

// API endpoint for flight expenses data
app.get('/api/flights/expenses', authenticateToken, async (_req, res) => {
  try {
    if (supabase) {
      // Get all flights with their expenses
      const { data: flights, error: flightsError } = await supabase.from(
        'flights'
      ).select(`
          *,
          expenses!exp_flight (
            id,
            exp_type,
            exp_subtype,
            exp_amount,
            exp_currency,
            exp_invoice_type,
            exp_place,
            exp_fuel_quan,
            exp_fuel_provider,
            exp_invoice,
            invoices!exp_invoice (
              id,
              inv_number
            )
          )
        `);

      if (flightsError) {
        console.log(
          'Supabase error fetching flights with expenses:',
          flightsError.message
        );
        return res
          .status(500)
          .json({ error: 'Failed to fetch flight expenses data' });
      }

      return res.json(sortFlightsLogically(flights || []));
    }

    res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.log('Error fetching flight expenses:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint for single flight expenses by flight number
app.get(
  '/api/flights/:flightNumber/expenses',
  authenticateToken,
  async (req, res) => {
    try {
      const flightNumber = decodeURIComponent(req.params.flightNumber);

      if (supabase) {
        // Get all flights with this flight number
        const { data: flights, error: flightsError } = await supabase
          .from('flights')
          .select(
            `
          id,
          flt_number,
          flt_date,
          flt_dep,
          flt_arr
        `
          )
          .eq('flt_number', flightNumber);

        if (flightsError) {
          console.log('Supabase error fetching flights:', flightsError.message);
          return res.status(500).json({ error: 'Failed to fetch flights' });
        }

        if (!flights || flights.length === 0) {
          return res.status(404).json({ error: 'Flight not found' });
        }

        // Get all flight IDs
        const flightIds = flights.map(f => f.id);

        // Get all expenses for all flights with this flight number
        const { data: expenses, error: expensesError } = await supabase
          .from('expenses')
          .select(
            `
          id,
          exp_type,
          exp_subtype,
          exp_amount,
          exp_currency,
          exp_invoice_type,
          exp_place,
          exp_fuel_quan,
          exp_fuel_provider,
          exp_comments,
          exp_flight,
          invoices!exp_invoice (
            id,
            inv_number
          ),
          flights!exp_flight (
            id,
            flt_date
          )
        `
          )
          .in('exp_flight', flightIds);

        if (expensesError) {
          console.log(
            'Supabase error fetching expenses:',
            expensesError.message
          );
          return res.status(500).json({ error: 'Failed to fetch expenses' });
        }

        // Return combined data
        return res.json({
          flt_number: flightNumber,
          flights: flights,
          expenses: expenses || [],
        });
      }

      res.status(503).json({ error: 'Database not available' });
    } catch (error) {
      console.log('Error fetching flight expenses:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST endpoint to add new flight
app.post(
  '/api/flights',
  authenticateToken,
  requireSuperadmin,
  async (req, res) => {
    try {
      const {
        flt_date,
        flt_number,
        flt_dep,
        flt_arr,
        flt_time,
        flt_block,
        flt_comments,
        flt_status,
      } = req.body;

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

      // Validate status if provided
      const validStatuses = ['Planned', 'Completed', 'Invoiced', 'Cancelled'];
      if (flt_status && !validStatuses.includes(flt_status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
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
              flt_comments: flt_comments || null,
              flt_status: flt_status || 'Planned',
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
  }
);

// API endpoint to get single invoice data
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoiceId = req.params.id;

    if (supabase) {
      const { data: invoice, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (error || !invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      return res.json(invoice);
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({ error: 'Database not available' });
  } catch (error) {
    console.error('Error fetching invoice:', error);
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
                   id,
                   inv_number
                 ),
                 flights!exp_flight (
                   flt_number,
                   flt_date,
                   flt_dep,
                   flt_arr
                 )
               `
        )
        .order('id', { ascending: false });

      if (error) {
        console.log('Supabase error, using mock data:', error.message);
        return res.json(mockData.expenses);
      }

      // Enrich expenses with invoice type names
      if (data && data.length > 0) {
        const invoiceTypeIds = [
          ...new Set(data.map((e: any) => e.exp_invoice_type).filter(Boolean)),
        ];

        const invoiceTypeNamesMap: { [key: string]: any } = {};
        if (invoiceTypeIds.length > 0) {
          const { data: invoiceTypes } = await supabase
            .from('invoice_types')
            .select('id, name')
            .in('id', invoiceTypeIds);
          if (invoiceTypes) {
            invoiceTypes.forEach((it: any) => {
              invoiceTypeNamesMap[it.id] = it;
            });
          }
        }

        // Enrich expenses with invoice type objects
        const enrichedData = data.map((expense: any) => ({
          ...expense,
          invoice_types: expense.exp_invoice_type
            ? invoiceTypeNamesMap[expense.exp_invoice_type]
            : null,
        }));

        return res.json(enrichedData);
      }

      return res.json(data || []);
    }

    res.json(mockData.expenses);
  } catch (error) {
    console.log('Error fetching expenses:', error);
    res.json(mockData.expenses);
  }
});

// Export expenses report to Excel
app.get('/api/expenses/export-excel', authenticateSession, async (req, res) => {
  try {
    const yearFilter = (req.query.year as string) || 'current';
    const showSubcategories = req.query.showSubcategories === 'true';
    const reportForATS = req.query.reportForATS === 'true';

    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Get expenses data (same as /api/expenses)
    const { data: expenses, error } = await supabase
      .from('expenses')
      .select(
        `
        *,
        invoices!exp_invoice (
          id,
          inv_number
        ),
        flights!exp_flight (
          flt_number,
          flt_date,
          flt_dep,
          flt_arr
        )
      `
      )
      .order('id', { ascending: false });

    if (error) {
      console.error('Error fetching expenses for export:', error);
      return res.status(500).json({ error: 'Failed to fetch expenses' });
    }

    if (!expenses || expenses.length === 0) {
      return res.status(404).json({ error: 'No expenses found' });
    }

    // Enrich expenses with invoice type names (same as /api/expenses)
    let enrichedExpenses = expenses;
    if (expenses && expenses.length > 0 && supabase) {
      const invoiceTypeIds = [
        ...new Set(
          expenses.map((e: any) => e.exp_invoice_type).filter(Boolean)
        ),
      ];

      const invoiceTypeNamesMap: { [key: string]: any } = {};
      if (invoiceTypeIds.length > 0) {
        const { data: invoiceTypes } = await supabase
          .from('invoice_types')
          .select('id, name')
          .in('id', invoiceTypeIds);
        if (invoiceTypes) {
          invoiceTypes.forEach((it: any) => {
            invoiceTypeNamesMap[it.id] = it;
          });
        }
      }

      // Enrich expenses with invoice type objects
      enrichedExpenses = expenses.map((expense: any) => ({
        ...expense,
        invoice_types: expense.exp_invoice_type
          ? invoiceTypeNamesMap[expense.exp_invoice_type]
          : null,
      }));
    }

    // Currency conversion rates (same as client)
    const CURRENCY_RATES = {
      AED_TO_USD: 3.6735,
      AED_TO_EUR: 4.3119,
    };

    // Expense categories (same as client)
    const NON_FLIGHT_CATEGORIES = [
      'CAMO and Management',
      'Crew',
      'Disbursement fee',
      'Insurance charge',
      'Maintenance',
      'Subscriptions',
      'Other charges', // non-flights subtype
      'FalconCare',
      'Honeywell',
    ];

    // Get base expense category (same logic as client)
    const getBaseExpenseCategory = (expense: any): string | null => {
      const type = ((expense.exp_type || '') as string).toLowerCase();

      // Check for non-flight categories
      if (
        type === 'camo and management' ||
        (type.includes('camo') && type.includes('management'))
      ) {
        return 'CAMO and Management';
      }
      if (type === 'crew') {
        return 'Crew';
      }
      if (type === 'disbursement fee' || type.includes('disbursement')) {
        return 'Disbursement fee';
      }
      if (type === 'insurance charge' || type.includes('insurance')) {
        return 'Insurance charge';
      }
      if (type === 'maintenance') {
        return 'Maintenance';
      }
      if (type === 'subscriptions' || type.includes('subscription')) {
        return 'Subscriptions';
      }
      if (
        type === 'falconcare' ||
        type.includes('falconcare') ||
        type.includes('falcon care')
      ) {
        return 'FalconCare';
      }
      if (type === 'honeywell') {
        return 'Honeywell';
      }

      // Check for flight categories
      if (
        type === 'ground handling' ||
        type.includes('ground handling') ||
        type.includes('groundhandling')
      ) {
        return 'Ground handling';
      }
      if (type === 'fuel') {
        return 'Fuel';
      }
      if (
        type === 'navigation charges' ||
        type.includes('navigation') ||
        type.includes('enroute')
      ) {
        return 'Navigation charges';
      }
      if (
        type === 'overfly charges' ||
        type.includes('overfly') ||
        type.includes('overflight')
      ) {
        return 'Overfly charges';
      }
      if (
        type === 'catering' ||
        type.includes('catering') ||
        type.includes('food')
      ) {
        return 'Catering';
      }
      if (
        type === 'flight planning' ||
        type.includes('flight planning') ||
        type.includes('flightplanning')
      ) {
        return 'Flight planning';
      }

      // Check for Other charges
      if (type === 'other charges' || type.includes('other charges')) {
        return 'Other charges';
      }

      // Return null if not in any category
      return null;
    };

    // Get expense category with subtype (same logic as client)
    const getExpenseCategory = (expense: any): string | null => {
      const subtype = ((expense.exp_subtype || '') as string).trim();
      const baseCategory = getBaseExpenseCategory(expense);

      if (baseCategory === null) {
        return null;
      }

      return subtype ? `${baseCategory} - ${subtype}` : baseCategory;
    };

    // Check if expense is non-flight related (same logic as client)
    const isNonFlightExpense = (expense: any): boolean | null => {
      const baseCategory = getBaseExpenseCategory(expense);

      // If category is null, expense doesn't belong to any group - skip it
      if (baseCategory === null) {
        return null;
      }

      // Check if base category is in non-flight list
      return NON_FLIGHT_CATEGORIES.includes(baseCategory);
    };

    // Check if expense period starts before October 2025
    const isPeriodBeforeOctober2025 = (expense: any): boolean => {
      if (!expense.exp_period_start) {
        return false; // If no period, don't filter it out
      }
      const periodStart = new Date(expense.exp_period_start);
      const october2025 = new Date('2025-10-01');
      return periodStart < october2025;
    };

    // Check if expense is a Disbursement fee
    const isDisbursementFee = (expense: any): boolean => {
      const baseCategory = getBaseExpenseCategory(expense);
      return baseCategory === 'Disbursement fee';
    };

    // Find related Disbursement fee expenses for a given expense
    const findRelatedDisbursementFees = (
      expense: any,
      allExpenses: any[]
    ): any[] => {
      const disbursementFees: any[] = [];

      for (const exp of allExpenses) {
        if (!isDisbursementFee(exp)) {
          continue;
        }

        // Match by invoice
        if (expense.exp_invoice && exp.exp_invoice !== expense.exp_invoice) {
          continue;
        }
        if (!expense.exp_invoice && exp.exp_invoice) {
          continue;
        }

        // Match by flight if exists
        if (expense.exp_flight) {
          if (exp.exp_flight !== expense.exp_flight) {
            continue;
          }
        } else {
          if (exp.exp_flight !== null) {
            continue;
          }
        }

        // Match by period if exists
        if (expense.exp_period_start && expense.exp_period_end) {
          if (
            exp.exp_period_start !== expense.exp_period_start ||
            exp.exp_period_end !== expense.exp_period_end
          ) {
            continue;
          }
        } else {
          if (exp.exp_period_start !== null || exp.exp_period_end !== null) {
            continue;
          }
        }

        // Match by place if exists
        if (expense.exp_place) {
          if (exp.exp_place !== expense.exp_place) {
            continue;
          }
        } else {
          if (exp.exp_place !== null) {
            continue;
          }
        }

        // This disbursement fee matches the expense
        disbursementFees.push(exp);
      }

      return disbursementFees;
    };

    // Apply ATS filter if enabled
    let filteredExpenses = enrichedExpenses;
    if (reportForATS) {
      const excludedExpenseIds = new Set<number>();

      // First pass: identify expenses to exclude
      for (const expense of enrichedExpenses) {
        if (isPeriodBeforeOctober2025(expense)) {
          excludedExpenseIds.add(expense.id);
        }
      }

      // Second pass: identify related Disbursement fees to exclude
      for (const expense of enrichedExpenses) {
        if (excludedExpenseIds.has(expense.id)) {
          const relatedFees = findRelatedDisbursementFees(
            expense,
            enrichedExpenses
          );
          for (const fee of relatedFees) {
            excludedExpenseIds.add(fee.id);
          }
        }
      }

      // Filter out excluded expenses
      filteredExpenses = enrichedExpenses.filter(
        (exp: any) => !excludedExpenseIds.has(exp.id)
      );
    }

    const convertCurrency = (
      amount: number,
      fromCurrency: string,
      toCurrency: string
    ): number => {
      if (!amount || !fromCurrency || !toCurrency) return 0;
      if (fromCurrency === toCurrency) return amount;

      if (fromCurrency === 'EUR') {
        const amountInAED = amount * CURRENCY_RATES.AED_TO_EUR;
        if (toCurrency === 'AED') {
          return amountInAED;
        } else if (toCurrency === 'USD') {
          return amountInAED / CURRENCY_RATES.AED_TO_USD;
        }
      }

      if (toCurrency === 'EUR') {
        let amountInAED = 0;
        if (fromCurrency === 'USD') {
          amountInAED = amount * CURRENCY_RATES.AED_TO_USD;
        } else if (fromCurrency === 'AED') {
          amountInAED = amount;
        }
        return amountInAED / CURRENCY_RATES.AED_TO_EUR;
      }

      let amountInUSD = amount;
      if (fromCurrency === 'AED') {
        amountInUSD = amount / CURRENCY_RATES.AED_TO_USD;
      }

      if (toCurrency === 'USD') {
        return amountInUSD;
      } else if (toCurrency === 'AED') {
        return amountInUSD * CURRENCY_RATES.AED_TO_USD;
      }

      return amount;
    };

    // Process expenses data (same logic as client)
    const expensesByMonth: {
      [key: string]: { [category: string]: { USD: number; AED: number } };
    } = {};
    const categoryGroups = {
      nonFlight: {} as {
        [category: string]: {
          [monthKey: string]: { USD: number; AED: number };
        };
      },
      flight: {} as {
        [category: string]: {
          [monthKey: string]: { USD: number; AED: number };
        };
      },
    };
    const allMonthsSet = new Set<string>();

    // Income items (Credit note and Charter profit) - same logic as client
    const incomeItems = {
      creditNote: {} as { [monthKey: string]: { USD: number; AED: number } },
      charterProfit: {} as { [monthKey: string]: { USD: number; AED: number } },
    };

    // Helper function to split expense by months (same logic as client)
    const splitExpenseByMonths = (
      expense: any
    ): Array<{ monthKey: string; amount: number; currency: string }> => {
      const amount = parseFloat(expense.exp_amount) || 0;
      const currency = expense.exp_currency || 'USD';
      const periodStart = expense.exp_period_start;
      const periodEnd = expense.exp_period_end;
      const flightId = expense.exp_flight;

      if (flightId && expense.flights && expense.flights.flt_date) {
        const flightDate = new Date(expense.flights.flt_date);
        const monthKey = `${flightDate.getFullYear()}-${String(flightDate.getMonth() + 1).padStart(2, '0')}`;
        return [{ monthKey, amount, currency }];
      }

      if (periodStart && periodEnd) {
        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        const startYear = start.getFullYear();
        const startMonth = start.getMonth();
        const endYear = end.getFullYear();
        const endMonth = end.getMonth();
        const endDay = end.getDate();

        const isSingleMonth =
          endDay === 1 &&
          ((endMonth === (startMonth + 1) % 12 && endYear === startYear) ||
            (endMonth === 0 && endYear === startYear + 1));

        const totalMonths = isSingleMonth
          ? 1
          : (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

        const monthlyAmount = totalMonths > 0 ? amount / totalMonths : amount;
        const months: Array<{
          monthKey: string;
          amount: number;
          currency: string;
        }> = [];

        let currentYear = startYear;
        let currentMonth = startMonth;

        for (let i = 0; i < totalMonths; i++) {
          const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
          months.push({ monthKey, amount: monthlyAmount, currency });

          currentMonth++;
          if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
          }
        }

        return months;
      }

      const date = expense.created_at
        ? new Date(expense.created_at)
        : new Date();
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return [{ monthKey, amount, currency }];
    };

    filteredExpenses.forEach((expense: any) => {
      // Check if this is an income item (Credit note or Charter profit)
      const expCategory = expense.exp_category || 'expense';
      const invoiceTypeName =
        expense.invoice_types?.name || expense.exp_invoice_type || '';
      const invoiceTypeNameLower = (
        typeof invoiceTypeName === 'string' ? invoiceTypeName : ''
      )
        .toLowerCase()
        .trim();

      const isCreditNote =
        expCategory === 'income_credit_note' ||
        (invoiceTypeNameLower.includes('credit') &&
          invoiceTypeNameLower.includes('note'));

      const isCharterProfit =
        expCategory === 'income_charter_profit' ||
        (invoiceTypeNameLower.includes('charter') &&
          invoiceTypeNameLower.includes('profit'));

      if (isCreditNote || isCharterProfit) {
        // Process as income item
        const incomeType = isCreditNote ? 'creditNote' : 'charterProfit';
        const months = splitExpenseByMonths(expense);

        for (const { monthKey, amount, currency } of months) {
          allMonthsSet.add(monthKey);

          if (!incomeItems[incomeType][monthKey]) {
            incomeItems[incomeType][monthKey] = { USD: 0, AED: 0 };
          }

          // Add amount in original currency and convert to fill both columns
          if (currency === 'USD') {
            incomeItems[incomeType][monthKey].USD += amount;
            incomeItems[incomeType][monthKey].AED += convertCurrency(
              amount,
              'USD',
              'AED'
            );
          } else if (currency === 'AED') {
            incomeItems[incomeType][monthKey].AED += amount;
            incomeItems[incomeType][monthKey].USD += convertCurrency(
              amount,
              'AED',
              'USD'
            );
          } else if (currency === 'EUR') {
            incomeItems[incomeType][monthKey].USD += convertCurrency(
              amount,
              'EUR',
              'USD'
            );
            incomeItems[incomeType][monthKey].AED += convertCurrency(
              amount,
              'EUR',
              'AED'
            );
          } else {
            incomeItems[incomeType][monthKey].USD += convertCurrency(
              amount,
              currency,
              'USD'
            );
            incomeItems[incomeType][monthKey].AED += convertCurrency(
              amount,
              currency,
              'AED'
            );
          }
        }
        return; // Skip regular expense processing for income items
      }

      // Process regular expenses (NOT income items)
      const baseCategory = getBaseExpenseCategory(expense);

      // Skip expenses that don't belong to any category (same as client)
      if (baseCategory === null) {
        return;
      }

      // Determine which category to use based on showSubcategories flag
      const displayCategory = showSubcategories
        ? getExpenseCategory(expense)
        : baseCategory;

      // If getExpenseCategory returned null, use baseCategory
      const finalCategory = displayCategory || baseCategory;

      const isNonFlight = isNonFlightExpense(expense);
      const group = isNonFlight
        ? categoryGroups.nonFlight
        : categoryGroups.flight;

      if (!group[finalCategory]) {
        group[finalCategory] = {};
      }

      const amount = parseFloat(expense.exp_amount) || 0;
      const currency = expense.exp_currency || 'USD';
      const periodStart = expense.exp_period_start;
      const periodEnd = expense.exp_period_end;
      const flightId = expense.exp_flight;

      let monthKeys: string[] = [];

      if (flightId && expense.flights && expense.flights.flt_date) {
        const flightDate = new Date(expense.flights.flt_date);
        const monthKey = `${flightDate.getFullYear()}-${String(flightDate.getMonth() + 1).padStart(2, '0')}`;
        monthKeys = [monthKey];
      } else if (periodStart && periodEnd) {
        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        const startYear = start.getFullYear();
        const startMonth = start.getMonth();
        const endYear = end.getFullYear();
        const endMonth = end.getMonth();
        const endDay = end.getDate();

        const isSingleMonth =
          endDay === 1 &&
          ((endMonth === (startMonth + 1) % 12 && endYear === startYear) ||
            (endMonth === 0 && endYear === startYear + 1));

        const totalMonths = isSingleMonth
          ? 1
          : (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

        let currentYear = startYear;
        let currentMonth = startMonth;

        for (let i = 0; i < totalMonths; i++) {
          const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
          monthKeys.push(monthKey);
          allMonthsSet.add(monthKey);

          currentMonth++;
          if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
          }
        }
      } else {
        const date = expense.created_at
          ? new Date(expense.created_at)
          : new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthKeys = [monthKey];
      }

      for (const monthKey of monthKeys) {
        allMonthsSet.add(monthKey);
        if (!expensesByMonth[monthKey]) {
          expensesByMonth[monthKey] = {};
        }

        if (!group[finalCategory][monthKey]) {
          group[finalCategory][monthKey] = { USD: 0, AED: 0 };
        }

        // Calculate monthly amount (same as client)
        const totalMonths = monthKeys.length || 1;
        const monthlyAmount = totalMonths > 0 ? amount / totalMonths : amount;

        if (currency === 'USD') {
          group[finalCategory][monthKey].USD += monthlyAmount;
          group[finalCategory][monthKey].AED += convertCurrency(
            monthlyAmount,
            'USD',
            'AED'
          );
        } else if (currency === 'AED') {
          group[finalCategory][monthKey].AED += monthlyAmount;
          group[finalCategory][monthKey].USD += convertCurrency(
            monthlyAmount,
            'AED',
            'USD'
          );
        } else if (currency === 'EUR') {
          group[finalCategory][monthKey].USD += convertCurrency(
            monthlyAmount,
            'EUR',
            'USD'
          );
          group[finalCategory][monthKey].AED += convertCurrency(
            monthlyAmount,
            'EUR',
            'AED'
          );
        } else {
          // Unknown currency, try to convert to USD and AED
          group[finalCategory][monthKey].USD += convertCurrency(
            monthlyAmount,
            currency,
            'USD'
          );
          group[finalCategory][monthKey].AED += convertCurrency(
            monthlyAmount,
            currency,
            'AED'
          );
        }
      }
    });

    // Add months from income items to allMonthsSet
    Object.keys(incomeItems.creditNote).forEach(monthKey =>
      allMonthsSet.add(monthKey)
    );
    Object.keys(incomeItems.charterProfit).forEach(monthKey =>
      allMonthsSet.add(monthKey)
    );

    // Filter months by year
    const allMonths = Array.from(allMonthsSet).sort();
    const currentYear = new Date().getFullYear();
    let filteredMonths = allMonths;

    if (yearFilter === 'current') {
      filteredMonths = allMonths.filter(monthKey => {
        const year = parseInt(monthKey.split('-')[0], 10);
        return year === currentYear;
      });
    }

    if (filteredMonths.length === 0) {
      return res
        .status(404)
        .json({ error: 'No data available for the selected period' });
    }

    // Prepare Excel data
    const data: any[][] = [];

    // Header row 1
    const headerRow1 = ['Category'];
    filteredMonths.forEach(monthKey => {
      const parts = monthKey.split('-');
      const year = parseInt(parts[0] || '0', 10);
      const month = parseInt(parts[1] || '1', 10);
      const monthName = new Date(year, month - 1).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });
      headerRow1.push(monthName, '');
    });
    data.push(headerRow1);

    // Header row 2
    const headerRow2 = [''];
    filteredMonths.forEach(() => {
      headerRow2.push('USD', 'AED');
    });
    data.push(headerRow2);

    // Category groups and sorting order (same as client)
    const CATEGORY_GROUPS = {
      group1: [
        'CAMO and Management',
        'Flight planning',
        'Subscriptions',
        'Maintenance',
        'Insurance charge',
        'Crew',
      ],
      group2: ['FalconCare', 'Honeywell'],
      group3: [
        'Ground handling',
        'Fuel',
        'Navigation charges',
        'Overfly charges',
        'Catering',
        'Other charges',
        'Disbursement fee',
      ],
    };

    // Get sort order for a category
    const getCategorySortOrder = (category: string): number => {
      const allCategories = [
        ...CATEGORY_GROUPS.group1,
        ...CATEGORY_GROUPS.group2,
        ...CATEGORY_GROUPS.group3,
      ];
      const index = allCategories.indexOf(category);
      return index >= 0 ? index : 999; // Unknown categories go to the end
    };

    // Combine all categories and sort by custom order (same as client)
    const allCategories: Array<{
      category: string;
      source: 'nonFlight' | 'flight';
    }> = [];

    // Collect all categories from both groups
    Object.keys(categoryGroups.nonFlight).forEach(category => {
      allCategories.push({ category, source: 'nonFlight' });
    });
    Object.keys(categoryGroups.flight).forEach(category => {
      allCategories.push({ category, source: 'flight' });
    });

    // Sort by custom order (same as client - extract base category for sorting)
    allCategories.sort((a, b) => {
      // Extract base category (before " - ")
      const baseCategoryA = a.category.split(' - ')[0];
      const baseCategoryB = b.category.split(' - ')[0];

      const orderA = getCategorySortOrder(baseCategoryA);
      const orderB = getCategorySortOrder(baseCategoryB);

      // If same base category, sort alphabetically by full category name
      if (orderA === orderB) {
        return a.category.localeCompare(b.category);
      }

      return orderA - orderB;
    });

    // Add category rows
    allCategories.forEach(({ category, source }) => {
      const row: any[] = [category];
      const categoryData =
        source === 'nonFlight'
          ? categoryGroups.nonFlight[category]
          : categoryGroups.flight[category];

      filteredMonths.forEach(monthKey => {
        const monthData = categoryData[monthKey] || { USD: 0, AED: 0 };
        row.push(monthData.USD, monthData.AED);
      });

      data.push(row);
    });

    // Add Credit note row (before Total)
    const creditNoteRow: any[] = ['Credit note'];
    filteredMonths.forEach(monthKey => {
      const creditNoteData = incomeItems.creditNote[monthKey] || {
        USD: 0,
        AED: 0,
      };
      creditNoteRow.push(creditNoteData.USD, creditNoteData.AED);
    });
    data.push(creditNoteRow);

    // Add Total row
    // Total = Sum of all regular expenses - Credit note
    const totalRow: any[] = ['Total'];

    filteredMonths.forEach(monthKey => {
      let totalUSD = 0;
      let totalAED = 0;

      // Sum all categories for this month (only regular expenses)
      allCategories.forEach(({ category, source }) => {
        const categoryData =
          source === 'nonFlight'
            ? categoryGroups.nonFlight[category]
            : categoryGroups.flight[category];

        const monthData = categoryData[monthKey] || { USD: 0, AED: 0 };
        totalUSD += monthData.USD;
        totalAED += monthData.AED;
      });

      // Subtract Credit note from Total (Credit note reduces expenses)
      const creditNoteData = incomeItems.creditNote[monthKey] || {
        USD: 0,
        AED: 0,
      };
      totalUSD -= creditNoteData.USD;
      totalAED -= creditNoteData.AED;

      totalRow.push(totalUSD, totalAED);
    });

    data.push(totalRow);

    // Add Charter profit row (after Total)
    const charterProfitRow: any[] = ['Charter profit'];
    filteredMonths.forEach(monthKey => {
      const charterProfitData = incomeItems.charterProfit[monthKey] || {
        USD: 0,
        AED: 0,
      };
      charterProfitRow.push(charterProfitData.USD, charterProfitData.AED);
    });
    data.push(charterProfitRow);

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [{ wch: 25 }];
    filteredMonths.forEach(() => {
      colWidths.push({ wch: 15 }, { wch: 15 });
    });
    ws['!cols'] = colWidths;

    // Apply currency formatting to USD and AED columns
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    // Format header rows (bold)
    for (let row = 0; row <= 1; row++) {
      for (let col = 0; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;
        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.font = { bold: true };
        ws[cellAddress].s.fill = { fgColor: { rgb: 'E5E7EB' } };
        ws[cellAddress].s.alignment = {
          horizontal: 'center',
          vertical: 'center',
        };
      }
    }

    // Format data rows with currency formatting
    for (let row = 2; row <= range.e.r; row++) {
      for (let col = 1; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;

        // Determine if this is USD or AED column
        // USD columns are odd (1, 3, 5, ...), AED columns are even (2, 4, 6, ...)
        const isUSD = col % 2 === 1;

        if (typeof ws[cellAddress].v === 'number') {
          // Apply currency format using 'z' property (number format string)
          // Format syntax: [Red] for colors, # for digits, 0 for required digits
          if (isUSD) {
            // USD format: $#,##0.00
            ws[cellAddress].z = '$#,##0.00';
            // Also set in style for compatibility
            if (!ws[cellAddress].s) ws[cellAddress].s = {};
            ws[cellAddress].s.numFmt = '$#,##0.00';
          } else {
            // AED format: #,##0.00 with thousands separator (dirhams)
            // Using standard number format for AED
            ws[cellAddress].z = '#,##0.00';
            // Also set in style for compatibility
            if (!ws[cellAddress].s) ws[cellAddress].s = {};
            ws[cellAddress].s.numFmt = '#,##0.00';
          }

          // Apply styling
          if (!ws[cellAddress].s) ws[cellAddress].s = {};
          ws[cellAddress].s.alignment = {
            horizontal: 'right',
            vertical: 'center',
          };
        }
      }
    }

    // Format Credit note, Total, and Charter profit rows (bold with background)
    // Find row indices: Credit note is before Total, Charter profit is after Total
    const creditNoteRowIndex = data.findIndex(row => row[0] === 'Credit note');
    const totalRowIndex = data.findIndex(row => row[0] === 'Total');
    const charterProfitRowIndex = data.findIndex(
      row => row[0] === 'Charter profit'
    );

    // Format Credit note row
    if (creditNoteRowIndex >= 0) {
      for (let col = 0; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({
          r: creditNoteRowIndex,
          c: col,
        });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.font = { bold: true };
        ws[cellAddress].s.fill = { fgColor: { rgb: 'F3F4F6' } };

        if (col > 0 && typeof ws[cellAddress].v === 'number') {
          const isUSD = col % 2 === 1;
          if (isUSD) {
            ws[cellAddress].z = '$#,##0.00';
            ws[cellAddress].s.numFmt = '$#,##0.00';
          } else {
            ws[cellAddress].z = '#,##0.00';
            ws[cellAddress].s.numFmt = '#,##0.00';
          }
          ws[cellAddress].s.alignment = {
            horizontal: 'right',
            vertical: 'center',
          };
        }
      }
    }

    // Format Total row
    if (totalRowIndex >= 0) {
      for (let col = 0; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({
          r: totalRowIndex,
          c: col,
        });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.font = { bold: true };
        ws[cellAddress].s.fill = { fgColor: { rgb: 'F3F4F6' } };

        if (col > 0 && typeof ws[cellAddress].v === 'number') {
          const isUSD = col % 2 === 1;
          if (isUSD) {
            ws[cellAddress].z = '$#,##0.00';
            ws[cellAddress].s.numFmt = '$#,##0.00';
          } else {
            ws[cellAddress].z = '#,##0.00';
            ws[cellAddress].s.numFmt = '#,##0.00';
          }
          ws[cellAddress].s.alignment = {
            horizontal: 'right',
            vertical: 'center',
          };
        }
      }
    }

    // Format Charter profit row
    if (charterProfitRowIndex >= 0) {
      for (let col = 0; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({
          r: charterProfitRowIndex,
          c: col,
        });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.font = { bold: true };
        ws[cellAddress].s.fill = { fgColor: { rgb: 'F3F4F6' } };

        if (col > 0 && typeof ws[cellAddress].v === 'number') {
          const isUSD = col % 2 === 1;
          if (isUSD) {
            ws[cellAddress].z = '$#,##0.00';
            ws[cellAddress].s.numFmt = '$#,##0.00';
          } else {
            ws[cellAddress].z = '#,##0.00';
            ws[cellAddress].s.numFmt = '#,##0.00';
          }
          ws[cellAddress].s.alignment = {
            horizontal: 'right',
            vertical: 'center',
          };
        }
      }
    }

    // Add worksheet
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses Report');

    // Generate filename (ensure proper encoding)
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `Expenses_Report_${yearFilter === 'all' ? 'AllYears' : yearFilter}_${dateStr}.xlsx`;

    // Set headers for file download (use filename* for proper encoding)
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    // Send file with cell styles enabled
    const buffer = XLSX.write(wb, {
      type: 'buffer',
      bookType: 'xlsx',
      cellStyles: true,
    });
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting expenses to Excel:', error);
    res.status(500).json({ error: 'Failed to export expenses to Excel' });
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
            flt_number,
            flt_dep,
            flt_arr
          )
        `
        )
        .eq('exp_invoice', invoiceId)
        .order('exp_invoice_type', { ascending: true });

      if (error) {
        console.log('Supabase error fetching invoice expenses:', error.message);
        return res.status(500).json({ error: 'Failed to fetch expenses' });
      }

      // Enrich expenses with type names
      if (data && data.length > 0) {
        // Get unique type IDs
        const typeIds = [...new Set(data.map(e => e.exp_type).filter(Boolean))];
        const subtypeIds = [
          ...new Set(data.map(e => e.exp_subtype).filter(Boolean)),
        ];
        const invoiceTypeIds = [
          ...new Set(data.map(e => e.exp_invoice_type).filter(Boolean)),
        ];

        // Fetch type names
        const typeNamesMap: { [key: string]: any } = {};
        if (typeIds.length > 0) {
          const { data: types } = await supabase
            .from('expense_types')
            .select('id, name')
            .in('id', typeIds);
          if (types) {
            types.forEach(t => {
              typeNamesMap[t.id] = t;
            });
          }
        }

        const subtypeNamesMap: { [key: string]: any } = {};
        if (subtypeIds.length > 0) {
          const { data: subtypes } = await supabase
            .from('expense_subtypes')
            .select('id, name')
            .in('id', subtypeIds);
          if (subtypes) {
            subtypes.forEach(s => {
              subtypeNamesMap[s.id] = s;
            });
          }
        }

        const invoiceTypeNamesMap: { [key: string]: any } = {};
        if (invoiceTypeIds.length > 0) {
          const { data: invoiceTypes } = await supabase
            .from('invoice_types')
            .select('id, name')
            .in('id', invoiceTypeIds);
          if (invoiceTypes) {
            invoiceTypes.forEach(it => {
              invoiceTypeNamesMap[it.id] = it;
            });
          }
        }

        // Enrich expenses with type objects
        const enrichedData = data.map((expense: any) => ({
          ...expense,
          expense_types: expense.exp_type
            ? typeNamesMap[expense.exp_type]
            : null,
          expense_subtypes: expense.exp_subtype
            ? subtypeNamesMap[expense.exp_subtype]
            : null,
          invoice_types: expense.exp_invoice_type
            ? invoiceTypeNamesMap[expense.exp_invoice_type]
            : null,
        }));

        return res.json(enrichedData);
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
    const { inv_date, inv_number, inv_amount, inv_currency, inv_tags } =
      req.body;

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
            inv_tags: inv_tags || '', // Use provided tags or empty string
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

// PUT endpoint to update existing invoice
app.put('/api/invoices/:id', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { inv_date, inv_number, inv_amount, inv_currency, inv_tags } =
      req.body;

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
      // Get current invoice data for logging
      const { data: currentInvoice, error: fetchError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (fetchError) {
        console.log('Supabase error fetching invoice:', fetchError.message);
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const { data, error } = await supabase
        .from('invoices')
        .update({
          inv_date,
          inv_number,
          inv_amount: amount,
          inv_currency,
          inv_tags: inv_tags || '',
        })
        .eq('id', invoiceId)
        .select();

      if (error) {
        console.log('Supabase error updating invoice:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to update invoice in database' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'invoices',
        invoiceId,
        currentInvoice,
        data[0],
        'system',
        req
      );

      return res.status(200).json({
        message: 'Invoice updated successfully',
        data: data[0],
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error updating invoice:', error);
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

// PUT endpoint to update invoice status
app.put('/api/invoices/:id/status', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { inv_filled, inv_disputed } = req.body;

    if (!invoiceId) {
      return res.status(400).json({
        error: 'Invoice ID is required',
      });
    }

    if (supabase) {
      // First get the current invoice data for logging
      const { data: currentInvoice, error: fetchError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (fetchError) {
        console.log('Supabase error fetching invoice:', fetchError.message);
        return res.status(404).json({ error: 'Invoice not found' });
      }

      // Prepare update data
      const updateData: any = {};
      if (inv_filled !== undefined) updateData.inv_filled = inv_filled;
      if (inv_disputed !== undefined) updateData.inv_disputed = inv_disputed;

      // Update the invoice
      const { data, error } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', invoiceId)
        .select();

      if (error) {
        console.log('Supabase error updating invoice:', error.message);
        return res.status(500).json({ error: 'Failed to update invoice' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'invoices',
        invoiceId,
        currentInvoice,
        data[0],
        'system',
        req
      );

      return res.status(200).json({
        message: 'Invoice updated successfully',
        data: data[0],
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error updating invoice:', error);
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

// PATCH endpoint to update flight status
app.patch('/api/flights/:id/status', authenticateToken, async (req, res) => {
  try {
    const flightId = req.params.id;
    const { flt_status } = req.body;

    if (!flightId) {
      return res.status(400).json({
        error: 'Flight ID is required',
      });
    }

    // Validate status
    const validStatuses = ['Planned', 'Completed', 'Invoiced', 'Cancelled'];
    if (!flt_status || !validStatuses.includes(flt_status)) {
      return res.status(400).json({
        error: `Status is required and must be one of: ${validStatuses.join(', ')}`,
      });
    }

    if (supabase) {
      // First get the current flight data for logging
      const { data: oldFlight, error: fetchError } = await supabase
        .from('flights')
        .select('*')
        .eq('id', flightId)
        .single();

      if (fetchError || !oldFlight) {
        console.log('Supabase error fetching flight:', fetchError?.message);
        return res.status(404).json({ error: 'Flight not found' });
      }

      // Update the status
      const { data: updatedFlight, error: updateError } = await supabase
        .from('flights')
        .update({ flt_status })
        .eq('id', flightId)
        .select()
        .single();

      if (updateError) {
        console.log(
          'Supabase error updating flight status:',
          updateError.message
        );
        return res
          .status(500)
          .json({ error: 'Failed to update flight status' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'flights',
        flightId,
        oldFlight,
        updatedFlight,
        'system',
        req
      );

      return res.status(200).json({
        message: 'Flight status updated successfully',
        data: updatedFlight,
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error updating flight status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE endpoint to remove expense
app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const expenseId = req.params.id;

    if (!expenseId) {
      return res.status(400).json({
        error: 'Expense ID is required',
      });
    }

    if (supabase) {
      // First get the expense data for logging and to find related disbursement fee
      const { data: expense, error: fetchError } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', expenseId)
        .single();

      if (fetchError) {
        console.log('Supabase error fetching expense:', fetchError.message);
        return res.status(404).json({ error: 'Expense not found' });
      }

      // Find related disbursement fee expense
      // Disbursement fee is linked by: same invoice, same flight (if exists), same period (if exists)
      // and type is Disbursement fee
      let disbursementFeeId = null;

      // Get Disbursement fee type ID
      const { data: disbursementType } = await supabase
        .from('expense_types')
        .select('id')
        .ilike('name', '%disbursement%')
        .single();

      if (disbursementType) {
        // Build query to find disbursement fee
        let query = supabase
          .from('expenses')
          .select('id')
          .eq('exp_invoice', expense.exp_invoice)
          .eq('exp_type', disbursementType.id);

        // Match by flight if exists
        if (expense.exp_flight) {
          query = query.eq('exp_flight', expense.exp_flight);
        } else {
          query = query.is('exp_flight', null);
        }

        // Match by period if exists
        if (expense.exp_period_start && expense.exp_period_end) {
          query = query
            .eq('exp_period_start', expense.exp_period_start)
            .eq('exp_period_end', expense.exp_period_end);
        } else {
          query = query.is('exp_period_start', null).is('exp_period_end', null);
        }

        // Match by place if exists
        if (expense.exp_place) {
          query = query.eq('exp_place', expense.exp_place);
        } else {
          query = query.is('exp_place', null);
        }

        // Also check if comments contain information about this expense
        // Format: "Type - Subtype, Amount Currency, Period/Flight"
        const { data: disbursementFees } = await query;

        if (disbursementFees && disbursementFees.length > 0) {
          // Check comments to find the exact match
          for (const fee of disbursementFees) {
            const { data: feeData } = await supabase
              .from('expenses')
              .select('exp_comments, exp_amount, exp_currency')
              .eq('id', fee.id)
              .single();

            if (feeData && feeData.exp_comments) {
              // Check if comment contains amount and currency from original expense
              const amountStr = parseFloat(expense.exp_amount).toFixed(2);
              const currencyStr = expense.exp_currency || 'AED';
              if (
                feeData.exp_comments.includes(amountStr) &&
                feeData.exp_comments.includes(currencyStr)
              ) {
                disbursementFeeId = fee.id;
                break;
              }
            }
          }

          // If no exact match found by comment, use first match
          if (!disbursementFeeId && disbursementFees.length > 0) {
            disbursementFeeId = disbursementFees[0].id;
          }
        }
      }

      // Delete disbursement fee first if found
      if (disbursementFeeId) {
        const { error: feeDeleteError } = await supabase
          .from('expenses')
          .delete()
          .eq('id', disbursementFeeId);

        if (feeDeleteError) {
          console.log(
            'Supabase error deleting disbursement fee:',
            feeDeleteError.message
          );
          // Continue with main expense deletion even if fee deletion fails
        }
      }

      // Delete the main expense
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expenseId);

      if (error) {
        console.log('Supabase error deleting expense:', error.message);
        return res
          .status(500)
          .json({ error: 'Failed to delete expense from database' });
      }

      // Log the activity
      await logActivity(
        'DELETE',
        'expenses',
        expenseId,
        expense,
        null,
        'system',
        req
      );

      return res.status(200).json({
        message: 'Expense deleted successfully',
        disbursementFeeDeleted: !!disbursementFeeId,
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error deleting expense:', error);
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

    // Check period length constraint (likely max 12 months)
    if (
      exp_period_start &&
      exp_period_end &&
      exp_period_start.trim() !== '' &&
      exp_period_end.trim() !== ''
    ) {
      const startDate =
        exp_period_start.includes('-') && exp_period_start.length === 7
          ? `${exp_period_start}-01`
          : exp_period_start;

      const endDate =
        exp_period_end.includes('-') && exp_period_end.length === 7
          ? exp_period_start === exp_period_end
            ? `${getNextMonth(exp_period_end)}-01`
            : `${exp_period_end}-01`
          : exp_period_end;

      const start = new Date(startDate);
      const end = new Date(endDate);

      // Calculate months difference
      const monthsDiff =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth());

      console.log('🔍 PERIOD LENGTH CHECK:', {
        startDate,
        endDate,
        monthsDiff,
        constraint: 'expenses_period_months_chk',
      });

      // If period is too long, return error
      if (monthsDiff > 12) {
        return res.status(400).json({
          error: `Period too long: ${monthsDiff} months. Maximum allowed period is 12 months.`,
        });
      }
    }

    if (supabase) {
      // Debug logging for period dates
      console.log('🔍 PERIOD DEBUG:', {
        exp_period_start,
        exp_period_end,
        start_processed:
          exp_period_start && exp_period_start.trim() !== ''
            ? exp_period_start.includes('-') && exp_period_start.length === 7
              ? `${exp_period_start}-01`
              : exp_period_start
            : null,
        end_processed:
          exp_period_end && exp_period_end.trim() !== ''
            ? exp_period_end.includes('-') && exp_period_end.length === 7
              ? exp_period_start === exp_period_end
                ? `${getNextMonth(exp_period_end)}-01` // For single month, use next month
                : `${exp_period_end}-01` // For multi-month, use first day of the end month
              : exp_period_end
            : null,
      });

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
              ? exp_period_start === exp_period_end
                ? `${getNextMonth(exp_period_end)}-01` // For single month, use next month
                : `${exp_period_end}-01` // For multi-month, use first day of the end month
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

      console.log('🔍 EXPENSE DATA TO INSERT:', expenseData);

      const { data, error } = await supabase
        .from('expenses')
        .insert([expenseData])
        .select();

      if (error) {
        console.log('Supabase error adding expense:', error.message);
        console.log('🔍 FULL ERROR:', error);
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

// PUT endpoint to update existing expense
app.put('/api/expenses/:id', async (req, res) => {
  try {
    const expenseId = req.params.id;
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
      update_disbursement_fee,
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

    // Check period length constraint (likely max 12 months)
    if (
      exp_period_start &&
      exp_period_end &&
      exp_period_start.trim() !== '' &&
      exp_period_end.trim() !== ''
    ) {
      const startDate =
        exp_period_start.includes('-') && exp_period_start.length === 7
          ? `${exp_period_start}-01`
          : exp_period_start;

      const endDate =
        exp_period_end.includes('-') && exp_period_end.length === 7
          ? exp_period_start === exp_period_end
            ? `${getNextMonth(exp_period_end)}-01`
            : `${exp_period_end}-01`
          : exp_period_end;

      const start = new Date(startDate);
      const end = new Date(endDate);

      // Calculate months difference
      const monthsDiff =
        (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth());

      console.log('🔍 PERIOD LENGTH CHECK (UPDATE):', {
        startDate,
        endDate,
        monthsDiff,
        constraint: 'expenses_period_months_chk',
      });

      // If period is too long, return error
      if (monthsDiff > 12) {
        return res.status(400).json({
          error: `Period too long: ${monthsDiff} months. Maximum allowed period is 12 months.`,
        });
      }
    }

    if (supabase) {
      // Get current expense data for logging
      const { data: currentExpense } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', expenseId)
        .single();

      if (!currentExpense) {
        return res.status(404).json({
          error: 'Expense not found',
        });
      }

      // Debug logging for period dates
      console.log('🔍 PERIOD DEBUG (UPDATE):', {
        exp_period_start,
        exp_period_end,
        start_processed:
          exp_period_start && exp_period_start.trim() !== ''
            ? exp_period_start.includes('-') && exp_period_start.length === 7
              ? `${exp_period_start}-01`
              : exp_period_start
            : null,
        end_processed:
          exp_period_end && exp_period_end.trim() !== ''
            ? exp_period_end.includes('-') && exp_period_end.length === 7
              ? exp_period_start === exp_period_end
                ? `${getNextMonth(exp_period_end)}-01` // For single month, use next month
                : `${exp_period_end}-01` // For multi-month, use first day of the end month
              : exp_period_end
            : null,
      });

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
              ? exp_period_start === exp_period_end
                ? `${getNextMonth(exp_period_end)}-01` // For single month, use next month
                : `${exp_period_end}-01` // For multi-month, use first day of the end month
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

      console.log('🔍 EXPENSE DATA TO UPDATE:', expenseData);

      const { data, error } = await supabase
        .from('expenses')
        .update(expenseData)
        .eq('id', expenseId)
        .select();

      if (error) {
        console.log('Supabase error updating expense:', error.message);
        console.log('🔍 FULL ERROR:', error);
        return res
          .status(500)
          .json({ error: 'Failed to update expense in database' });
      }

      // Log the activity
      await logActivity(
        'UPDATE',
        'expenses',
        expenseId,
        currentExpense,
        data[0],
        'system',
        req
      );

      // If update_disbursement_fee flag is set, find and update related disbursement fee
      let disbursementFeeUpdated = false;
      if (update_disbursement_fee && exp_amount) {
        // Get Disbursement fee type (both ID and name)
        const { data: disbursementType } = await supabase
          .from('expense_types')
          .select('id, name')
          .ilike('name', '%disbursement%')
          .single();

        if (disbursementType) {
          // Use updated expense data to find disbursement fee
          const invoiceId = exp_invoice || currentExpense.exp_invoice;
          const flightId =
            exp_flight !== undefined ? exp_flight : currentExpense.exp_flight;
          const periodStart =
            expenseData.exp_period_start || currentExpense.exp_period_start;
          const periodEnd =
            expenseData.exp_period_end || currentExpense.exp_period_end;
          const place =
            exp_place !== undefined ? exp_place : currentExpense.exp_place;

          // Build query to find disbursement fee
          // Note: exp_type is stored as name (string) in DB, not ID
          let query = supabase
            .from('expenses')
            .select('id, exp_comments, exp_amount, exp_currency')
            .eq('exp_invoice', invoiceId)
            .eq('exp_type', disbursementType.name);

          // Match by flight if exists
          if (flightId) {
            query = query.eq('exp_flight', flightId);
          } else {
            query = query.is('exp_flight', null);
          }

          // Match by period if exists
          if (periodStart && periodEnd) {
            query = query
              .eq('exp_period_start', periodStart)
              .eq('exp_period_end', periodEnd);
          } else {
            query = query
              .is('exp_period_start', null)
              .is('exp_period_end', null);
          }

          // Match by place if exists
          if (place) {
            query = query.eq('exp_place', place);
          } else {
            query = query.is('exp_place', null);
          }

          const { data: disbursementFees } = await query;

          if (disbursementFees && disbursementFees.length > 0) {
            // Find exact match by checking comments for old amount and currency
            let disbursementFeeId = null;
            const oldAmountStr = parseFloat(
              currentExpense.exp_amount || 0
            ).toFixed(2);
            const oldCurrencyStr = currentExpense.exp_currency || 'AED';

            for (const fee of disbursementFees) {
              if (fee.exp_comments) {
                // Check if comment contains old amount and currency from original expense
                if (
                  fee.exp_comments.includes(oldAmountStr) &&
                  fee.exp_comments.includes(oldCurrencyStr)
                ) {
                  disbursementFeeId = fee.id;
                  break;
                }
              }
            }

            // If no exact match found by comment, use first match
            if (!disbursementFeeId && disbursementFees.length > 0) {
              disbursementFeeId = disbursementFees[0].id;
            }

            if (disbursementFeeId) {
              // Calculate new disbursement fee amount (5% of updated expense amount)
              const disbursementAmount = parseFloat(exp_amount) * 0.05;
              const newCurrency =
                exp_currency || currentExpense.exp_currency || 'AED';

              // Get type and subtype names for comment
              // Use updated names if provided, otherwise get from current expense
              let typeNameForComment = expTypeName;
              let subtypeNameForComment = expSubtypeName;

              if (!typeNameForComment && currentExpense.exp_type) {
                // Get type name from current expense (it's stored as name in DB)
                typeNameForComment = currentExpense.exp_type;
              }

              if (!subtypeNameForComment && currentExpense.exp_subtype) {
                // Get subtype name from current expense (it's stored as name in DB)
                subtypeNameForComment = currentExpense.exp_subtype;
              }

              // Build new comment with updated expense information
              let comment = typeNameForComment || '';
              if (
                subtypeNameForComment &&
                subtypeNameForComment !== 'Select Subtype'
              ) {
                comment += ` - ${subtypeNameForComment}`;
              }
              comment += `, ${exp_amount} ${newCurrency}`;

              // Add period or flight info
              if (periodStart && periodEnd) {
                // Format period as YYYY-MM - YYYY-MM to match client-side format
                const startDate = new Date(periodStart);
                const endDate = new Date(periodEnd);
                const startFormatted = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
                const endFormatted = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
                comment += `, ${startFormatted} - ${endFormatted}`;
              } else if (flightId) {
                // Get flight info for comment
                const { data: flightData } = await supabase
                  .from('flights')
                  .select('flt_number, flt_dep, flt_arr')
                  .eq('id', flightId)
                  .single();
                if (flightData) {
                  comment += `, ${flightData.flt_number} - ${flightData.flt_dep} to ${flightData.flt_arr}`;
                }
              }

              // Get disbursement subtype and invoice type names (stored as strings in DB)
              let disbursementSubtypeName = null;
              let disbursementInvoiceTypeName = null;

              if (disbursementType.id) {
                const { data: subtypes } = await supabase
                  .from('expense_subtypes')
                  .select('name')
                  .eq('expense_type_id', disbursementType.id)
                  .ilike('name', '%disbursement%')
                  .limit(1);
                if (subtypes && subtypes.length > 0) {
                  disbursementSubtypeName = subtypes[0].name;
                }
              }

              const { data: invoiceTypes } = await supabase
                .from('invoice_types')
                .select('name')
                .ilike('name', '%disbursement%')
                .limit(1);
              if (invoiceTypes && invoiceTypes.length > 0) {
                disbursementInvoiceTypeName = invoiceTypes[0].name;
              }

              // Update disbursement fee expense
              // Note: exp_type, exp_subtype, and exp_invoice_type are stored as names (strings) in DB
              const disbursementFeeData: any = {
                exp_amount: disbursementAmount,
                exp_currency: newCurrency,
                exp_comments: comment,
                exp_place: place || null,
                exp_flight: flightId || null,
                exp_period_start: periodStart || null,
                exp_period_end: periodEnd || null,
              };

              // Only update subtype and invoice type if we found them
              if (disbursementSubtypeName) {
                disbursementFeeData.exp_subtype = disbursementSubtypeName;
              }
              if (disbursementInvoiceTypeName) {
                disbursementFeeData.exp_invoice_type =
                  disbursementInvoiceTypeName;
              }

              const { error: feeUpdateError } = await supabase
                .from('expenses')
                .update(disbursementFeeData)
                .eq('id', disbursementFeeId);

              if (!feeUpdateError) {
                disbursementFeeUpdated = true;
                console.log(
                  'Disbursement fee updated successfully:',
                  disbursementFeeId
                );
              } else {
                console.log(
                  'Error updating disbursement fee:',
                  feeUpdateError.message
                );
              }
            }
          } else {
            // Disbursement fee not found - create new one
            // Calculate disbursement fee amount (5% of expense amount)
            const disbursementAmount = parseFloat(exp_amount) * 0.05;
            const newCurrency =
              exp_currency || currentExpense.exp_currency || 'AED';

            // Get type and subtype names for comment
            // Use updated names if provided, otherwise get from current expense
            let typeNameForComment = expTypeName;
            let subtypeNameForComment = expSubtypeName;

            if (!typeNameForComment && currentExpense.exp_type) {
              // Get type name from current expense (it's stored as name in DB)
              typeNameForComment = currentExpense.exp_type;
            }

            if (!subtypeNameForComment && currentExpense.exp_subtype) {
              // Get subtype name from current expense (it's stored as name in DB)
              subtypeNameForComment = currentExpense.exp_subtype;
            }

            // Build comment with updated expense information
            let comment = typeNameForComment || '';
            if (
              subtypeNameForComment &&
              subtypeNameForComment !== 'Select Subtype'
            ) {
              comment += ` - ${subtypeNameForComment}`;
            }
            comment += `, ${exp_amount} ${newCurrency}`;

            // Add period or flight info
            if (periodStart && periodEnd) {
              // Format period as YYYY-MM - YYYY-MM to match client-side format
              const startDate = new Date(periodStart);
              const endDate = new Date(periodEnd);
              const startFormatted = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
              const endFormatted = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
              comment += `, ${startFormatted} - ${endFormatted}`;
            } else if (flightId) {
              // Get flight info for comment
              const { data: flightData } = await supabase
                .from('flights')
                .select('flt_number, flt_dep, flt_arr')
                .eq('id', flightId)
                .single();
              if (flightData) {
                comment += `, ${flightData.flt_number} - ${flightData.flt_dep} to ${flightData.flt_arr}`;
              }
            }

            // Get disbursement subtype and invoice type names (stored as strings in DB)
            let disbursementSubtypeName = null;
            let disbursementInvoiceTypeName = null;

            if (disbursementType.id) {
              const { data: subtypes } = await supabase
                .from('expense_subtypes')
                .select('name')
                .eq('expense_type_id', disbursementType.id)
                .ilike('name', '%disbursement%')
                .limit(1);
              if (subtypes && subtypes.length > 0) {
                disbursementSubtypeName = subtypes[0].name;
              }
            }

            const { data: invoiceTypes } = await supabase
              .from('invoice_types')
              .select('name')
              .ilike('name', '%disbursement%')
              .limit(1);
            if (invoiceTypes && invoiceTypes.length > 0) {
              disbursementInvoiceTypeName = invoiceTypes[0].name;
            }

            // Create disbursement fee expense
            // Note: exp_type, exp_subtype, and exp_invoice_type are stored as names (strings) in DB
            const disbursementFeeData: any = {
              exp_type: disbursementType.name,
              exp_subtype: disbursementSubtypeName,
              exp_invoice_type: disbursementInvoiceTypeName,
              exp_amount: disbursementAmount.toFixed(2),
              exp_currency: newCurrency,
              exp_invoice: invoiceId,
              exp_flight: flightId || null,
              exp_period_start: periodStart || null,
              exp_period_end: periodEnd || null,
              exp_place: place || null,
              exp_comments: comment,
            };

            const { error: feeCreateError } = await supabase
              .from('expenses')
              .insert(disbursementFeeData);

            if (!feeCreateError) {
              disbursementFeeUpdated = true;
              console.log('Disbursement fee created successfully');
            } else {
              console.log(
                'Error creating disbursement fee:',
                feeCreateError.message
              );
            }
          }
        }
      }

      return res.status(200).json({
        message: 'Expense updated successfully',
        data: data[0],
        disbursementFeeUpdated,
      });
    }

    // Fallback for when Supabase is not available
    return res.status(503).json({
      error: 'Database not available',
    });
  } catch (error) {
    console.log('Error updating expense:', error);
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
      flights_this_year: 0,
      flights_last_year: 0,
      flights_change_percent: 0,
      invoices_pending: 0,
    };

    if (supabase) {
      try {
        // Получаем статистику из базы данных
        const [flightsResult, invoicesResult, expensesResult] =
          await Promise.all([
            supabase.from('flights').select('*'),
            supabase.from('invoices').select('*'),
            supabase.from('expenses').select('amount'),
          ]);

        if (!flightsResult.error) {
          const flights = flightsResult.data || [];
          stats.flights_count = flights.length;

          // Подсчитываем рейсы по годам
          const currentYear = new Date().getFullYear();
          const previousYear = currentYear - 1;

          stats.flights_this_year =
            flights.filter(flight => {
              if (!flight.flt_date) return false;
              const flightYear = new Date(flight.flt_date).getFullYear();
              return flightYear === currentYear;
            }).length || 0;

          stats.flights_last_year =
            flights.filter(flight => {
              if (!flight.flt_date) return false;
              const flightYear = new Date(flight.flt_date).getFullYear();
              return flightYear === previousYear;
            }).length || 0;

          // Вычисляем процент изменения
          if (stats.flights_last_year > 0) {
            stats.flights_change_percent =
              ((stats.flights_this_year - stats.flights_last_year) /
                stats.flights_last_year) *
              100;
          } else {
            stats.flights_change_percent =
              stats.flights_this_year > 0 ? 100 : 0;
          }
        }

        if (!invoicesResult.error) {
          // Считаем активные инвойсы (не заполненные или не оспоренные)
          stats.invoices_pending =
            invoicesResult.data?.filter(
              inv => !inv.inv_filled || inv.inv_disputed
            ).length || 0;
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
          flights_this_year: 1,
          flights_last_year: 1,
          flights_change_percent: 0,
          invoices_pending: 1,
        };
      }
    } else {
      // Mock статистика
      stats = {
        total_revenue: 5300,
        total_expenses: 20500,
        flights_count: 2,
        flights_this_year: 1,
        flights_last_year: 1,
        flights_change_percent: 0,
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

// ========== DATABASE BACKUP & RESTORE API ==========

// Create database backup
app.get('/api/backup/create', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    console.log('🔄 Creating database backup...');

    // Get all data from all tables
    const tables = [
      'flights',
      'invoices',
      'expenses',
      'expense_types',
      'expense_subtypes',
      'invoice_types',
      'activity_logs',
    ];

    const backupData: any = {
      metadata: {
        created_at: new Date().toISOString(),
        version: '1.0',
        tables: tables,
        total_records: 0,
      },
      data: {},
    };

    let totalRecords = 0;

    // Fetch data from each table
    for (const table of tables) {
      try {
        const { data, error } = await supabase.from(table).select('*');

        if (error) {
          console.warn(
            `Warning: Could not backup table ${table}:`,
            error.message
          );
          backupData.data[table] = [];
        } else {
          backupData.data[table] = data || [];
          totalRecords += (data || []).length;
          console.log(`✅ Backed up ${table}: ${(data || []).length} records`);
        }
      } catch (tableError) {
        console.warn(`Error backing up table ${table}:`, tableError);
        backupData.data[table] = [];
      }
    }

    backupData.metadata.total_records = totalRecords;

    // Log the backup activity
    await logActivity(
      'CREATE',
      'backup',
      null,
      null,
      { total_records: totalRecords, tables: tables },
      'system',
      req
    );

    console.log(
      `✅ Backup created successfully: ${totalRecords} total records`
    );

    // Set headers for file download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `jet-finances-backup-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backupData);
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({
      error: 'Failed to create backup',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Restore database from backup
app.post('/api/backup/restore', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const { backupData, options = {} } = req.body;
    const { clearExisting = false, skipErrors = true } = options;

    if (!backupData || !backupData.data) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    console.log('🔄 Starting database restore...');
    console.log('Options:', { clearExisting, skipErrors });

    const results: any = {
      success: true,
      tables: {},
      errors: [],
      total_restored: 0,
    };

    // If clearExisting is true, truncate all tables first
    if (clearExisting) {
      console.log('🗑️ Clearing existing data...');

      // Delete in reverse order to respect foreign key constraints
      const deleteOrder = [
        'activity_logs',
        'expenses',
        'invoices',
        'flights',
        'expense_subtypes',
        'expense_types',
        'invoice_types',
      ];

      for (const table of deleteOrder) {
        try {
          const { error } = await supabase
            .from(table)
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all records

          if (error) {
            console.warn(
              `Warning: Could not clear table ${table}:`,
              error.message
            );
            results.errors.push(`Failed to clear ${table}: ${error.message}`);
          } else {
            console.log(`✅ Cleared table ${table}`);
          }
        } catch (clearError) {
          console.warn(`Error clearing table ${table}:`, clearError);
          results.errors.push(`Error clearing ${table}: ${clearError}`);
        }
      }
    }

    // Restore data in correct order to respect foreign key constraints
    const restoreOrder = [
      'invoice_types',
      'expense_types',
      'expense_subtypes',
      'flights',
      'invoices',
      'expenses',
      'activity_logs',
    ];

    for (const table of restoreOrder) {
      const tableData = backupData.data[table];

      if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
        console.log(`⏭️ Skipping empty table: ${table}`);
        results.tables[table] = { restored: 0, skipped: 0, errors: [] };
        continue;
      }

      console.log(`🔄 Restoring table ${table}: ${tableData.length} records`);

      try {
        // Remove id and timestamps to let database generate new ones
        const cleanData = tableData.map(record => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, created_at, updated_at, ...cleanRecord } = record;
          return cleanRecord;
        });

        const { data, error } = await supabase
          .from(table)
          .insert(cleanData)
          .select();

        if (error) {
          console.error(`Error restoring table ${table}:`, error);
          results.tables[table] = {
            restored: 0,
            skipped: tableData.length,
            errors: [error.message],
          };
          results.errors.push(`Failed to restore ${table}: ${error.message}`);

          if (!skipErrors) {
            results.success = false;
            break;
          }
        } else {
          const restoredCount = data?.length || 0;
          results.tables[table] = {
            restored: restoredCount,
            skipped: tableData.length - restoredCount,
            errors: [],
          };
          results.total_restored += restoredCount;
          console.log(`✅ Restored table ${table}: ${restoredCount} records`);
        }
      } catch (restoreError) {
        console.error(`Exception restoring table ${table}:`, restoreError);
        results.tables[table] = {
          restored: 0,
          skipped: tableData.length,
          errors: [
            restoreError instanceof Error
              ? restoreError.message
              : 'Unknown error',
          ],
        };
        results.errors.push(`Exception restoring ${table}: ${restoreError}`);

        if (!skipErrors) {
          results.success = false;
          break;
        }
      }
    }

    // Log the restore activity
    await logActivity(
      'UPDATE',
      'backup_restore',
      null,
      null,
      {
        total_restored: results.total_restored,
        tables_restored: Object.keys(results.tables).length,
        errors: results.errors.length,
      },
      'system',
      req
    );

    console.log(
      `✅ Restore completed: ${results.total_restored} records restored`
    );

    res.json({
      success: results.success,
      message: results.success
        ? `Successfully restored ${results.total_restored} records`
        : 'Restore completed with errors',
      results: results,
    });
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({
      error: 'Failed to restore backup',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get backup info (table counts)
app.get('/api/backup/info', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const tables = [
      'flights',
      'invoices',
      'expenses',
      'expense_types',
      'expense_subtypes',
      'invoice_types',
      'activity_logs',
    ];

    const tableInfo: any = {};
    let totalRecords = 0;

    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error) {
          tableInfo[table] = { count: 0, error: error.message };
        } else {
          tableInfo[table] = { count: count || 0 };
          totalRecords += count || 0;
        }
      } catch {
        tableInfo[table] = { count: 0, error: 'Connection error' };
      }
    }

    res.json({
      total_records: totalRecords,
      tables: tableInfo,
      last_checked: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting backup info:', error);
    res.status(500).json({
      error: 'Failed to get backup info',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 404
app.use((_req, res) => {
  res.status(404).render('dashboard/index', { title: 'Not Found' });
});

// Ошибки
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Error handler:', err);

  // Для API эндпоинтов возвращаем JSON
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  // Для остальных запросов возвращаем HTML
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
