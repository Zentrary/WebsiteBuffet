const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      enum: ['cash', 'qr_payment'],
      default: 'cash',
    },
    cashReceived: {
      type: Number,
      min: 0,
    },
    changeDue: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,

      enum: ['awaiting_confirmation', 'pending', 'completed', 'failed'],
      default: 'pending',
    },
    paidAt: {
      type: Date,
    },
    receivedBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    confirmedAt: {
      type: Date,
    },
    note: {
      type: String,
      default: '',
    },
    slipImageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    slipUploadedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
paymentSchema.plugin(createMongooseSqlMirrorPlugin('Payment'));

module.exports = mongoose.model('Payment', paymentSchema);
