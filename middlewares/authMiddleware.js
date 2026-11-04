const jwt = require('jsonwebtoken');
const User = require('../models/User');
const userModel = require('../models/sql/userModel');

const STAFF_CACHE_TTL_MS = 15_000;
const MAX_STAFF_CACHE_ENTRIES = 500;
const staffStatusCache = new Map();

function invalidateStaffAuthCache(userId) {
  if (!userId) return;
  staffStatusCache.delete(String(userId));
}

function clearStaffAuthCache() {
  staffStatusCache.clear();
}

async function fetchMongoUserForTests(userId) {
  const query = User.findById(userId);
  if (!query) return null;
  if (typeof query.select === 'function') {
    const selected = query.select('username role isActive');
    if (selected && typeof selected.lean === 'function') {
      return selected.lean();
    }
    return selected;
  }
  return query;
}

async function verifyActiveStaffUser(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;

  const userId = decoded.id || decoded._id;
  if (!userId) return decoded;

  if (Boolean(User.__enforceInTests)) {
    const testUser = await fetchMongoUserForTests(String(userId));
    if (!testUser || testUser.isActive === false) return null;
    return {
      ...decoded,
      id: String(userId),
      _id: String(userId),
      username: testUser.username || decoded.username,
      role: testUser.role || decoded.role,
    };
  }

  if (!process.env.DATABASE_URL) {
    return decoded;
  }

  const key = String(userId);
  const now = Date.now();
  const cached = staffStatusCache.get(key);
  if (cached && cached.expiresAt > now) {
    if (!cached.isActive) return null;
    return {
      ...decoded,
      id: cached.id || key,
      _id: cached.id || key,
      username: cached.username,
      role: cached.role,
    };
  }

  let user = await userModel.findById(key);
  if (!user && decoded.username) {
    user = await userModel.findByUsername(decoded.username);
  }

  if (!user || user.isActive === false) {
    staffStatusCache.set(key, {
      id: key,
      isActive: false,
      role: '',
      username: '',
      expiresAt: now + STAFF_CACHE_TTL_MS,
    });
    return null;
  }

  if (staffStatusCache.size >= MAX_STAFF_CACHE_ENTRIES) {
    const oldest = staffStatusCache.keys().next().value;
    if (oldest !== undefined) staffStatusCache.delete(oldest);
  }

  const entry = {
    id: user.id,
    isActive: true,
    role: user.role || decoded.role,
    username: user.username || decoded.username,
    expiresAt: now + STAFF_CACHE_TTL_MS,
  };
  staffStatusCache.set(key, entry);
  if (user.id !== key) {
    staffStatusCache.set(user.id, entry);
  }

  return {
    ...decoded,
    id: user.id,
    _id: user.id,
    username: entry.username,
    role: entry.role,
  };
}

async function protect(req, res, next) {
  const authorization = req.headers.authorization;
  const bearerMatch = authorization && authorization.match(/^Bearer\s+(\S+)$/i);
  const token = bearerMatch ? bearerMatch[1] : null;

  if (!token) {
    return res
      .status(401)
      .json({ success: false, code: 'UNAUTHORIZED', message: 'Access denied.' });
  }

  if (!process.env.JWT_SECRET) {
    return next(new Error('JWT_SECRET is not configured.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const activeUser = await verifyActiveStaffUser(decoded);
    if (!activeUser) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        message: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งานหรือถูกลบแล้ว กรุณาเข้าสู่ระบบใหม่',
      });
    }
    req.user = activeUser;
    return next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'NotBeforeError'
    ) {
      return res
        .status(401)
        .json({ success: false, code: 'UNAUTHORIZED', message: 'Invalid token.' });
    }

    return next(error);
  }
}

function authorize(...roles) {
  return function authorizeRole(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You are not allowed to perform this action.',
      });
    }

    return next();
  };
}

module.exports = {
  protect,
  authorize,
  verifyActiveStaffUser,
  invalidateStaffAuthCache,
  clearStaffAuthCache,
};
