const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Queue',
      required: true,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
    },
    customerCount: {
      type: Number,
      default: 1,
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
    buffetPackageName: {
      type: String,
      default: '',
      trim: true,
    },
    buffetPricePerPerson: {
      type: Number,
      default: 0,
      min: 0,
    },
    hasRefillDrink: {
      type: Boolean,
      default: false,
    },
    refillPricePerPerson: {
      type: Number,
      default: 0,
      min: 0,
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
      required: true,
    },
    actualEndTime: {
      type: Date,
    },
    checkoutRequestedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'expired', 'cancelled'],
      default: 'active',
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    serviceCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    vat: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    grandTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: {
      type: Date,
    },

    memberId: {
      type: String,
      default: null,
    },
    memberPhone: {
      type: String,
      default: '',
    },
    memberName: {
      type: String,
      default: '',
    },
    memberTierName: {
      type: String,
      default: '',
    },
    benefitType: {
      type: String,
      enum: ['', 'NONE', 'TIER', 'PROMO'],
      default: '',
    },
    appliedPromotionId: {
      type: String,
      default: null,
    },
    appliedPromoCode: {
      type: String,
      default: '',
    },
    appliedPromoTitle: {
      type: String,
      default: '',
    },
    pointsToRedeem: {
      type: Number,
      default: 0,
      min: 0,
    },
    pointsEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    loyaltyProcessedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
sessionSchema.plugin(createMongooseSqlMirrorPlugin('Session'));

module.exports = mongoose.model('Session', sessionSchema);
