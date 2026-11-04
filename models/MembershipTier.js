const mongoose = require('mongoose');

const membershipTierSchema = new mongoose.Schema(
  {
    tierCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    tierName: {
      type: String,
      required: true,
      trim: true,
    },
    minPoints: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },
    pointsMultiplier: {
      type: Number,
      required: true,
      min: 0.1,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

membershipTierSchema.index({ minPoints: 1 });

module.exports = mongoose.model('MembershipTier', membershipTierSchema);
