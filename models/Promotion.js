const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema(
  {
    promoCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 30,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 400,
      default: '',
    },
    discountType: {
      type: String,
      enum: ['PERCENT', 'FIXED'],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0.01,
    },
    pointsCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    minSpend: {
      type: Number,
      min: 0,
      default: 0,
    },
    maxDiscount: {
      type: Number,
      min: 0,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

promotionSchema.index({ isActive: 1, pointsCost: 1 });

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
promotionSchema.plugin(createMongooseSqlMirrorPlugin('Promotion'));

module.exports = mongoose.model('Promotion', promotionSchema);
