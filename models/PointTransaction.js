const mongoose = require('mongoose');

const pointTransactionSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
      index: true,
    },
    promotionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Promotion',
      default: null,
    },
    sessionRef: {
      type: String,
      default: '',
      index: true,
    },
    transactionType: {
      type: String,
      enum: ['EARN', 'REDEEM', 'ADJUST'],
      required: true,
    },
    pointsDelta: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    billAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: String,
      trim: true,
      default: 'system',
    },
  },
  {
    timestamps: true,
  }
);

pointTransactionSchema.index({ createdAt: -1 });
pointTransactionSchema.index({ sessionRef: 1, transactionType: 1 });

module.exports = mongoose.model('PointTransaction', pointTransactionSchema);
