const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comment: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
feedbackSchema.plugin(createMongooseSqlMirrorPlugin('Feedback'));

module.exports = mongoose.model('Feedback', feedbackSchema);
