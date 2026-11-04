const { Pool } = require('pg');

const connectionCache = global.__buffetSqlCache || {
  pool: null,
  promise: null,
  info: null,
  lastUrl: null,
};
global.__buffetSqlCache = connectionCache;

function safeDecode(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseDatabaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  const parsed = new URL(trimmed);
  const host = parsed.hostname;
  const port = Number(parsed.port) || 5432;
  const database = (parsed.pathname || '/postgres').replace(/^\/+/, '') || 'postgres';
  const user = safeDecode(parsed.username) || 'postgres';
  const password = safeDecode(parsed.password);
  const sslMode = (parsed.searchParams.get('sslmode') || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const disableSsl = isLocal || sslMode === 'disable';

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  };
}

function buildCandidateConfigs(rawUrl) {
  const primary = parseDatabaseUrl(rawUrl);
  const directMatch = primary.host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  const poolerMatch = primary.host.match(/^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/i);

  let projectRef = null;
  let baseUser = primary.user;
  let region = (process.env.SUPABASE_REGION || 'ap-southeast-1').trim();
  const isDirectSupabaseHost = Boolean(directMatch);

  if (directMatch) {
    projectRef = directMatch[1];
    baseUser = primary.user.split('.')[0] || 'postgres';
  } else if (poolerMatch) {
    region = poolerMatch[1];
    const parts = primary.user.split('.');
    baseUser = parts[0] || 'postgres';
    projectRef = parts[1] || null;
  }

  const poolerCandidates = [];
  if (projectRef) {
    const poolerUser = `${baseUser}.${projectRef}`;
    for (const port of [6543, 5432]) {
      for (const cluster of ['aws-1', 'aws-0']) {
        poolerCandidates.push({
          host: `${cluster}-${region}.pooler.supabase.com`,
          port,
          database: primary.database,
          user: poolerUser,
          password: primary.password,
          ssl: { rejectUnauthorized: false },
        });
      }
    }
  }

  const ordered =
    isDirectSupabaseHost && process.env.VERCEL
      ? [...poolerCandidates, primary]
      : [primary, ...poolerCandidates];

  const seen = new Set();
  return ordered.filter((cfg) => {
    const key = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.database}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function tryConnectPool(cfg) {
  const baseOptions = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: process.env.VERCEL ? 5 : 10,
    idleTimeoutMillis: process.env.VERCEL ? 10000 : 30000,
    connectionTimeoutMillis: 8000,
  };

  const attempt = async (sslSetting) => {
    const pool = new Pool({ ...baseOptions, ssl: sslSetting });
    pool.on('error', (err) => {
      console.error('PostgreSQL idle client error:', err.message);
      if (connectionCache.pool === pool) {
        connectionCache.pool = null;
      }
    });
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      return pool;
    } catch (error) {
      await pool.end().catch(() => {});
      throw error;
    }
  };

  try {
    return await attempt(cfg.ssl);
  } catch (error) {
    if (cfg.ssl && /does not support SSL/i.test(error.message || '')) {
      return await attempt(false);
    }
    throw error;
  }
}

function getSQLConnectionInfo() {
  if (connectionCache.info) {
    return {
      connected: Boolean(connectionCache.pool),
      ...connectionCache.info,
    };
  }
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    return {
      connected: false,
      database: 'postgres',
      host: null,
      port: null,
    };
  }
  try {
    const parsed = parseDatabaseUrl(DATABASE_URL);
    return {
      connected: false,
      database: parsed.database,
      host: parsed.host,
      port: parsed.port,
    };
  } catch {
    return {
      connected: false,
      database: 'postgres',
      host: null,
      port: null,
    };
  }
}

async function connectSQL() {
  const { DATABASE_URL } = process.env;

  if (!DATABASE_URL || !String(DATABASE_URL).trim()) {
    throw new Error('DATABASE_URL is not configured.');
  }

  if (connectionCache.pool && connectionCache.lastUrl === DATABASE_URL) {
    return connectionCache.pool;
  }

  if (connectionCache.pool && connectionCache.lastUrl !== DATABASE_URL) {
    await closeSQL();
  }

  if (connectionCache.promise) {
    return connectionCache.promise;
  }

  const connectPromise = (async () => {
    const candidates = buildCandidateConfigs(DATABASE_URL);
    const errors = [];

    for (const cfg of candidates) {
      try {
        const pool = await tryConnectPool(cfg);
        connectionCache.pool = pool;
        connectionCache.lastUrl = DATABASE_URL;
        connectionCache.info = {
          database: cfg.database,
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
        };
        console.log(`PostgreSQL (Supabase) connected: ${cfg.host}:${cfg.port}/${cfg.database}`);
        return pool;
      } catch (error) {
        errors.push(`${cfg.host}:${cfg.port} -> ${error.message}`);
      }
    }

    const summary = errors[0] || 'Unknown PostgreSQL connection error';
    console.error('PostgreSQL connection failed across candidates:', errors.join(' | '));
    throw new Error(summary);
  })();

  connectionCache.promise = connectPromise;
  try {
    return await connectPromise;
  } finally {
    if (connectionCache.promise === connectPromise) {
      connectionCache.promise = null;
    }
  }
}

async function querySQL(text, params = []) {
  const pool = await connectSQL();
  const result = await pool.query(text, params);
  return { rows: result.rows, rowCount: result.rowCount };
}

async function withTransaction(callback) {
  const pool = await connectSQL();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function isSqlReady() {
  return Boolean(connectionCache.pool);
}

async function testSQLConnection() {
  try {
    await querySQL('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function closeSQL() {
  if (connectionCache.pool) {
    const activePool = connectionCache.pool;
    connectionCache.pool = null;
    connectionCache.info = null;
    connectionCache.lastUrl = null;
    await activePool.end().catch(() => {});
    console.log('PostgreSQL (Supabase) connection closed.');
  }
}

module.exports = {
  connectSQL,
  querySQL,
  withTransaction,
  isSqlReady,
  testSQLConnection,
  closeSQL,
  getSQLConnectionInfo,
};
