const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/sql/userModel');
const { invalidateStaffAuthCache } = require('../middlewares/authMiddleware');
const { recordAudit } = require('../utils/auditLog');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('buffet-dummy-timing-guard-password', 10);
const VALID_ROLES = new Set(['admin', 'manager', 'kitchen', 'waiter']);

function parseOptionalAge(rawAge) {
  if (rawAge === null || rawAge === undefined || String(rawAge).trim() === '') {
    return null;
  }
  const num = Number.parseInt(String(rawAge).trim(), 10);
  if (!Number.isFinite(num) || num < 15 || num > 100) {
    const err = new Error('กรุณาระบุอายุพนักงานระหว่าง 15–100 ปี');
    err.name = 'ValidationError';
    err.code = 'INVALID_STAFF_AGE';
    throw err;
  }
  return num;
}

function validateStaffInputs({ username, role, password, requirePassword = false }) {
  if (!username) {
    const err = new Error('กรุณาระบุชื่อผู้ใช้');
    err.name = 'ValidationError';
    err.code = 'INVALID_USERNAME';
    throw err;
  }
  if (!VALID_ROLES.has(role)) {
    const err = new Error('ตำแหน่งพนักงานไม่ถูกต้อง');
    err.name = 'ValidationError';
    err.code = 'INVALID_ROLE';
    throw err;
  }
  if (requirePassword && (!password || String(password).length < 4)) {
    const err = new Error('กรุณาระบุรหัสผ่านอย่างน้อย 4 ตัวอักษร');
    err.name = 'ValidationError';
    err.code = 'INVALID_PASSWORD';
    throw err;
  }
}

function buildStaffProfileFields(body = {}, existingUser = null) {
  const prefix =
    body.prefix !== undefined
      ? String(body.prefix || '')
          .trim()
          .slice(0, 30)
      : existingUser
        ? existingUser.prefix || ''
        : '';
  const firstName =
    body.firstName !== undefined
      ? String(body.firstName || '')
          .trim()
          .slice(0, 80)
      : existingUser
        ? existingUser.firstName || ''
        : '';
  const lastName =
    body.lastName !== undefined
      ? String(body.lastName || '')
          .trim()
          .slice(0, 80)
      : existingUser
        ? existingUser.lastName || ''
        : '';
  const nickname =
    body.nickname !== undefined
      ? String(body.nickname || '')
          .trim()
          .slice(0, 60)
      : existingUser
        ? existingUser.nickname || ''
        : '';
  const phone =
    body.phone !== undefined
      ? String(body.phone || '')
          .trim()
          .slice(0, 20)
      : existingUser
        ? existingUser.phone || ''
        : '';
  const age =
    body.age !== undefined
      ? parseOptionalAge(body.age)
      : existingUser
        ? (existingUser.age ?? null)
        : null;

  let fullName = '';
  if (firstName || lastName) {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  } else if (body.fullName !== undefined) {
    fullName = String(body.fullName || '').trim();
  } else if (existingUser) {
    fullName = existingUser.fullName || '';
  }

  return {
    prefix,
    firstName,
    lastName,
    fullName,
    nickname,
    age,
    phone,
  };
}

async function register(req, res) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        data: null,
        message: 'You are not allowed to perform this action.',
      });
    }

    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = typeof body.role === 'string' ? body.role.trim() : '';

    validateStaffInputs({ username, role, password, requirePassword: true });
    const profile = buildStaffProfileFields(body);
    const passwordHash = await bcrypt.hash(password, 12);

    const userData = await userModel.create({
      username,
      passwordHash,
      role,
      ...profile,
    });

    recordAudit(req, {
      action: 'STAFF_CREATE',
      targetType: 'User',
      targetId: userData.id,
      summary: `สร้างบัญชีพนักงาน ${userData.username} (${userData.role})`,
    });

    return res
      .status(201)
      .json({ success: true, data: userData, message: 'สร้างบัญชีผู้ใช้สำเร็จ' });
  } catch (error) {
    console.error('Register failed:', error);
    if (error.code === '23505' || error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_USERNAME',
        data: null,
        message: 'ชื่อผู้ใช้นี้มีในระบบแล้ว กรุณาใช้ชื่อผู้ใช้อื่น',
      });
    }
    const status = error.name === 'ValidationError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: error.code || (status === 400 ? 'INVALID_REQUEST' : 'REQUEST_FAILED'),
      data: null,
      message: status === 400 ? error.message || 'ข้อมูลบัญชีพนักงานไม่ถูกต้อง' : 'Request failed.',
    });
  }
}

async function login(req, res) {
  try {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        data: null,
        message: 'Invalid username or password.',
      });
    }

    const user = await userModel.findByUsername(username, { includePassword: true });
    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      recordAudit(req, {
        action: 'AUTH_LOGIN_FAILED',
        actorUsername: username,
        targetType: 'User',
        summary: `ล็อกอินไม่สำเร็จ (ไม่พบผู้ใช้ ${username})`,
      });
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        data: null,
        message: 'Invalid username or password.',
      });
    }

    const passwordMatched = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatched) {
      recordAudit(req, {
        action: 'AUTH_LOGIN_FAILED',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        targetType: 'User',
        targetId: user.id,
        summary: `รหัสผ่านไม่ถูกต้องสำหรับผู้ใช้ ${user.username}`,
      });
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        data: null,
        message: 'Invalid username or password.',
      });
    }

    if (!user.isActive) {
      recordAudit(req, {
        action: 'AUTH_LOGIN_BLOCKED_INACTIVE',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        targetType: 'User',
        targetId: user.id,
        summary: `ปฏิเสธการล็อกอินบัญชีที่ถูกระงับ (${user.username})`,
      });
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        data: null,
        message: 'This account is disabled.',
      });
    }
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured.');
    }

    await userModel.updateLastLogin(user.id).catch(() => {});

    const token = jwt.sign(
      { id: String(user.id), username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '8h' }
    );

    recordAudit(req, {
      action: 'AUTH_LOGIN_SUCCESS',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      targetType: 'User',
      targetId: user.id,
      summary: `เข้าสู่ระบบสำเร็จ (${user.username} / ${user.role})`,
    });

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          _id: user.id,
          username: user.username,
          prefix: user.prefix || '',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          fullName: user.fullName,
          nickname: user.nickname || '',
          age: user.age ?? null,
          phone: user.phone || '',
          role: user.role,
        },
      },
      message: 'เข้าสู่ระบบสำเร็จ',
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function getMe(req, res) {
  try {
    const userId = req.user && (req.user.id || req.user._id);
    const user = userId ? await userModel.findById(userId) : null;

    if (!user) {
      return res
        .status(404)
        .json({ success: false, code: 'USER_NOT_FOUND', data: null, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, data: user, message: 'ดึงข้อมูลผู้ใช้สำเร็จ' });
  } catch (error) {
    console.error('Get current user failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function getStaff(_req, res) {
  try {
    const users = await userModel.listAll();
    return res.status(200).json({ success: true, data: users, message: 'ดึงรายชื่อพนักงานสำเร็จ' });
  } catch (error) {
    console.error('Get staff failed:', error);
    return res
      .status(500)
      .json({ success: false, code: 'REQUEST_FAILED', data: null, message: 'Request failed.' });
  }
}

async function updateStaff(req, res) {
  try {
    const existing = await userModel.findById(req.params.id, { includePassword: true });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, code: 'USER_NOT_FOUND', data: null, message: 'User not found.' });
    }

    const body = req.body || {};
    const currentUserId = req.user && (req.user.id || req.user._id);
    const isSelf =
      Boolean(currentUserId) &&
      (String(currentUserId) === String(existing.id) ||
        (existing.mongoId && String(currentUserId) === String(existing.mongoId)));
    const nextIsActive =
      body.isActive !== undefined
        ? Boolean(body.isActive === true || body.isActive === 'true')
        : existing.isActive;
    const nextRole = body.role !== undefined ? String(body.role).trim() : existing.role;
    const nextUsername =
      body.username !== undefined ? String(body.username).trim() : existing.username;

    if (isSelf && (!nextIsActive || nextRole !== 'admin')) {
      return res.status(400).json({
        success: false,
        code: 'SELF_ACCOUNT_LOCKOUT_NOT_ALLOWED',
        data: null,
        message: 'ไม่สามารถระงับบัญชีหรือลดสิทธิ์แอดมินของตนเองได้',
      });
    }

    validateStaffInputs({ username: nextUsername, role: nextRole, requirePassword: false });

    let nextPasswordHash = existing.passwordHash;
    if (body.password && typeof body.password === 'string' && body.password.trim()) {
      nextPasswordHash = await bcrypt.hash(body.password, 12);
    }

    const profile = buildStaffProfileFields(body, existing);
    const userData = await userModel.updateById(existing.id, {
      username: nextUsername,
      passwordHash: nextPasswordHash,
      role: nextRole,
      isActive: nextIsActive,
      ...profile,
    });

    invalidateStaffAuthCache(existing.id);
    if (existing.mongoId) invalidateStaffAuthCache(existing.mongoId);

    recordAudit(req, {
      action: 'STAFF_UPDATE',
      targetType: 'User',
      targetId: userData.id,
      summary: `แก้ไขบัญชีพนักงาน ${userData.username} (${userData.role}, active=${userData.isActive})`,
    });

    return res
      .status(200)
      .json({ success: true, data: userData, message: 'แก้ไขข้อมูลพนักงานสำเร็จ' });
  } catch (error) {
    console.error('Update staff failed:', error);
    if (error.code === '23505' || error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_USERNAME',
        data: null,
        message: 'ชื่อผู้ใช้นี้มีในระบบแล้ว กรุณาใช้ชื่อผู้ใช้อื่น',
      });
    }
    const status = error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: error.code || (status === 400 ? 'INVALID_REQUEST' : 'REQUEST_FAILED'),
      data: null,
      message: status === 400 ? error.message || 'ข้อมูลบัญชีพนักงานไม่ถูกต้อง' : 'Request failed.',
    });
  }
}

async function deleteStaff(req, res) {
  try {
    const existing = await userModel.findById(req.params.id);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, code: 'USER_NOT_FOUND', data: null, message: 'User not found.' });
    }

    const currentUserId = req.user && (req.user.id || req.user._id);
    const isSelf =
      Boolean(currentUserId) &&
      (String(currentUserId) === String(existing.id) ||
        (existing.mongoId && String(currentUserId) === String(existing.mongoId)));
    if (isSelf) {
      return res.status(400).json({
        success: false,
        code: 'SELF_DELETE_NOT_ALLOWED',
        data: null,
        message: 'You cannot delete your own account.',
      });
    }

    await userModel.deleteById(existing.id);
    invalidateStaffAuthCache(existing.id);
    if (existing.mongoId) invalidateStaffAuthCache(existing.mongoId);

    recordAudit(req, {
      action: 'STAFF_DELETE',
      targetType: 'User',
      targetId: existing.id,
      summary: `ลบบัญชีพนักงาน ${existing.username} (${existing.role})`,
    });

    return res
      .status(200)
      .json({ success: true, data: { id: existing.id }, message: 'ลบบัญชีพนักงานสำเร็จ' });
  } catch (error) {
    console.error('Delete staff failed:', error);
    const status = error.name === 'CastError' ? 400 : 500;
    return res.status(status).json({
      success: false,
      code: status === 400 ? 'INVALID_REQUEST' : 'REQUEST_FAILED',
      data: null,
      message: status === 400 ? 'Invalid ID.' : 'Request failed.',
    });
  }
}

module.exports = { register, login, getMe, getStaff, updateStaff, deleteStaff };
