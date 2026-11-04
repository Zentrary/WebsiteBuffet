const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    memberCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    prefix: {
      type: String,
      trim: true,
      maxlength: 30,
      default: '',
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    nickname: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    age: {
      type: Number,
      min: 1,
      max: 120,
      default: null,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    tierCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'MEMBER',
    },
    currentPoints: {
      type: Number,
      min: 0,
      default: 0,
    },
    lifetimePoints: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalSpent: {
      type: Number,
      min: 0,
      default: 0,
    },
    visitCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    registeredVia: {
      type: String,
      enum: ['queue', 'web', 'staff', 'admin'],
      default: 'admin',
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

memberSchema.index({ fullName: 1 });
memberSchema.index({ nickname: 1 });
memberSchema.index({ tierCode: 1, isActive: 1 });
memberSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Member', memberSchema);
