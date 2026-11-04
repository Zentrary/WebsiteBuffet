const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Menu',
  },
  name: {
    type: String,
  },
  price: {
    type: Number,
    min: 0,
  },
  quantity: {
    type: Number,
    min: 1,
  },
  note: {
    type: String,
  },
  itemStatus: {
    type: String,
    enum: ['pending', 'accepted', 'cooking', 'ready', 'served', 'cancelled'],
    default: 'pending',
  },
});

const stockDeductionSchema = new mongoose.Schema(
  {
    menuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Menu',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
    },
    items: {
      type: [orderItemSchema],
      default: [],
    },
    stockDeductions: {
      type: [stockDeductionSchema],
      default: [],
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'cooking', 'ready', 'served', 'paid', 'cancelled'],
      default: 'pending',
    },
    acceptedAt: {
      type: Date,
    },
    cookingAt: {
      type: Date,
    },
    readyAt: {
      type: Date,
    },
    servedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
orderSchema.plugin(createMongooseSqlMirrorPlugin('Order'));

module.exports = mongoose.model('Order', orderSchema);
