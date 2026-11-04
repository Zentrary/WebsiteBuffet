const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema(
  {
    queueNumber: {
      type: String,
      required: true,
      match: /^Q\d{3,}$/,
    },
    businessDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },
    sequence: {
      type: Number,
      min: 1,
      default: null,
    },
    customerCount: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    diningStyle: {
      type: String,
      enum: ['alacarte', 'buffet'],
      default: 'alacarte',
    },
    buffetPackageCode: {
      type: String,
      default: '',
      trim: true,
    },
    hasRefillDrink: {
      type: Boolean,
      default: false,
    },
    customerName: {
      type: String,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    memberId: {
      type: String,
      default: null,
    },
    accessTokenHash: {
      type: String,
      select: false,
    },

    status: {
      type: String,
      enum: ['waiting', 'called', 'seated', 'completed', 'cancelled', 'no_show'],
      default: 'waiting',
    },
    preferredZone: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: null,
    },
    preferredTableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      default: null,
    },
    autoAssign: {
      type: Boolean,
      default: true,
    },
    assignedTableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      default: null,
    },
    assignmentNote: {
      type: String,
      default: '',
    },
    qrCodeData: {
      type: String,
    },
    calledAt: {
      type: Date,
    },
    seatedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    noShowAt: {
      type: Date,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
    },
  },
  {
    timestamps: true,
  }
);

queueSchema.index({ accessTokenHash: 1 }, { unique: true, sparse: true });
queueSchema.index(
  { businessDate: 1, queueNumber: 1 },
  { unique: true, partialFilterExpression: { businessDate: { $type: 'string' } } }
);
queueSchema.index({ businessDate: 1, sequence: 1 });
queueSchema.index({ status: 1, createdAt: 1 });
queueSchema.index({ status: 1, seatedAt: 1 });
queueSchema.index({ preferredZone: 1, status: 1 });

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
queueSchema.plugin(createMongooseSqlMirrorPlugin('Queue'));

module.exports = mongoose.model('Queue', queueSchema);
