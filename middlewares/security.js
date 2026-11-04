const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self' ws: wss: https://cdn.jsdelivr.net",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SENSITIVE_API_PREFIXES = [
  '/api/auth',
  '/api/admin',
  '/api/payment',
  '/api/members',
  '/api/report',
];

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripDangerousKeys(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      stripDangerousKeys(value[i], depth + 1);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.') || DANGEROUS_KEYS.has(key)) {
      delete value[key];
    } else {
      stripDangerousKeys(value[key], depth + 1);
    }
  }
  return value;
}

function sanitizeNoSql(req, _res, next) {
  if (req.body && typeof req.body === 'object') stripDangerousKeys(req.body);
  if (req.query && typeof req.query === 'object') stripDangerousKeys(req.query);
  if (req.params && typeof req.params === 'object') stripDangerousKeys(req.params);
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES);

  if (process.env.STRICT_FRAME_GUARD === 'true') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  const url = req.originalUrl || req.url || '';
  if (SENSITIVE_API_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    res.setHeader('Cache-Control', 'no-store, private');
  }

  next();
}

function parseConfiguredOrigins() {
  const raw = String(process.env.CLIENT_ORIGIN || '').trim();
  if (!raw || raw === '*') return new Set();
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

function corsOptionsDelegate(req, callback) {
  const origin = req.headers.origin;
  if (!origin) {
    return callback(null, { origin: false });
  }

  if (String(process.env.CLIENT_ORIGIN || '').trim() === '*') {
    return callback(null, { origin: true });
  }

  const configured = parseConfiguredOrigins();
  const normalizedOrigin = origin.replace(/\/+$/, '');
  if (configured.has(normalizedOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }

  try {
    const originHost = new URL(origin).host.toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const directHost = String(req.headers.host || '')
      .trim()
      .toLowerCase();

    if (
      (forwardedHost && originHost === forwardedHost) ||
      (directHost && originHost === directHost)
    ) {
      return callback(null, { origin: true, credentials: true });
    }
  } catch {}

  return callback(null, { origin: false });
}

module.exports = {
  securityHeaders,
  sanitizeNoSql,
  stripDangerousKeys,
  corsOptionsDelegate,
};
