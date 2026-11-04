const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { resolveClientIp } = require('../middlewares/rateLimit');

function recordAudit(
  req,
  {
    action,
    actorId,
    actorUsername,
    actorRole,
    targetType = '',
    targetId = '',
    summary = '',
    metadata = null,
  } = {}
) {
  if (!action || mongoose.connection.readyState !== 1) return;

  const user = (req && req.user) || {};
  const entry = {
    action: String(action).slice(0, 80),
    actorId: String(actorId ?? user.id ?? user._id ?? '') || null,
    actorUsername: String(actorUsername || user.username || 'anonymous').slice(0, 80),
    actorRole: String(actorRole || user.role || '').slice(0, 30),
    ip: req ? String(resolveClientIp(req)).slice(0, 80) : '',
    targetType: String(targetType || '').slice(0, 40),
    targetId: String(targetId || '').slice(0, 80),
    summary: String(summary || '').slice(0, 240),
    metadata,
  };

  setImmediate(() => {
    AuditLog.create(entry).catch((err) => {
      console.warn('[auditLog] skipped:', err.message);
    });
  });
}

module.exports = { recordAudit };
