const mongoose = require('mongoose');

const ZONE_ENUM = ['small', 'medium', 'large'];

const tableSchema = new mongoose.Schema(
  {
    tableNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    minCapacity: {
      type: Number,
      default: 1,
      min: 1,
    },
    zone: {
      type: String,
      enum: ZONE_ENUM,
      default: 'small',
    },
    status: {
      type: String,
      enum: ['available', 'reserved', 'occupied', 'cleaning'],
      default: 'available',
    },
    currentSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
    reservedForQueueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Queue',
      default: null,
    },
    lastSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

tableSchema.index({ zone: 1, status: 1 });
tableSchema.index({ minCapacity: 1, capacity: 1 });

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
tableSchema.plugin(createMongooseSqlMirrorPlugin('Table'));

module.exports = mongoose.model('Table', tableSchema);
module.exports.ZONE_ENUM = ZONE_ENUM;
