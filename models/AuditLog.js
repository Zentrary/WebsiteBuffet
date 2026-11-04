const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    actorId: {
      type: String,
      default: null,
    },
    actorUsername: {
      type: String,
      default: 'anonymous',
      trim: true,
      maxlength: 80,
    },
    actorRole: {
      type: String,
      default: '',
      trim: true,
      maxlength: 30,
    },
    ip: {
      type: String,
      default: '',
      maxlength: 80,
    },
    targetType: {
      type: String,
      default: '',
      trim: true,
      maxlength: 40,
    },
    targetId: {
      type: String,
      default: '',
      trim: true,
      maxlength: 80,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
      maxlength: 240,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 90 * 24 * 60 * 60,
    },
  },
  {
    versionKey: false,
  }
);

auditLogSchema.index({ createdAt: -1 });

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
auditLogSchema.plugin(createMongooseSqlMirrorPlugin('AuditLog'));

module.exports = mongoose.model('AuditLog', auditLogSchema);
