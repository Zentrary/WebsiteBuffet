const mongoose = require('mongoose');
const { DEFAULT_CATEGORY } = require('../config/menuCategories');

const menuSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      trim: true,
      default: DEFAULT_CATEGORY,
    },
    buffetTier: {
      type: String,
      enum: ['auto', 'SIGNATURE', 'PREMIUM', 'DELUXE', 'ALACARTE_ONLY'],
      default: 'auto',
    },
    imageUrl: {
      type: String,
      default: '/assets/images/default-food.jpg',
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    preparationTime: {
      type: Number,
      default: 10,
      min: 0,
    },
    stockQuantity: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'จำนวนคงเหลือต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
      },
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'จำนวนแจ้งเตือนใกล้หมดต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
      },
    },
    maxOrderQuantity: {
      type: Number,
      default: 99,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'จำนวนสั่งสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',
      },
    },
  },
  {
    timestamps: true,
  }
);

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
menuSchema.plugin(createMongooseSqlMirrorPlugin('Menu'));

module.exports = mongoose.model('Menu', menuSchema);
