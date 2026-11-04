const stores = new Map();
const MAX_BUCKETS_PER_STORE = 10_000;

function nowMs() {
  return Date.now();
}

function getStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
}

setInterval(() => {
  const t = nowMs();
  for (const store of stores.values()) {
    for (const [key, bucket] of store) {
      if (bucket.resetAt <= t) store.delete(key);
    }
  }
}, 60_000).unref();

function resolveClientIp(req) {
  if (!req) return 'unknown';
  const raw = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return (
    String(raw)
      .replace(/^::ffff:/, '')
      .trim() || 'unknown'
  );
}

function rateLimit(options = {}) {
  const name = options.name || 'default';
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 60_000;
  const max = Number.isFinite(options.max) ? options.max : 60;
  const message = options.message || 'คุณทำรายการเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่';
  const keyGenerator = options.keyGenerator || resolveClientIp;
  const store = getStore(name);

  return function rateLimitMiddleware(req, res, next) {
    const key = String(keyGenerator(req) || 'unknown').slice(0, 160);
    const t = nowMs();
    let bucket = store.get(key);

    if (!bucket || bucket.resetAt <= t) {
      if (!bucket && store.size >= MAX_BUCKETS_PER_STORE) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
      }
      bucket = { count: 0, resetAt: t + windowMs };
      store.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        data: null,
        message,
      });
    }

    return next();
  };
}

function keyByIp(req) {
  return resolveClientIp(req);
}

function keyByIpAndUsername(req) {
  const ip = resolveClientIp(req);
  const username =
    req && req.body && typeof req.body.username === 'string'
      ? req.body.username.trim().toLowerCase().slice(0, 60)
      : '';
  return username ? `${ip}:${username}` : ip;
}

function keyBySession(req) {
  const body = (req && req.body) || {};
  const params = (req && req.params) || {};
  const query = (req && req.query) || {};
  const raw = body.sessionId || params.sessionId || params.id || query.sessionId;
  const value = typeof raw === 'string' ? raw.trim().slice(0, 48) : '';
  return value ? `session:${value}:${resolveClientIp(req)}` : resolveClientIp(req);
}

module.exports = {
  rateLimit,
  resolveClientIp,
  keyByIp,
  keyByIpAndUsername,
  keyBySession,
};
