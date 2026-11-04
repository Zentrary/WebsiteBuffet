const mongoose = require('mongoose');

const queueCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    sequence: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { versionKey: false }
);

const { createMongooseSqlMirrorPlugin } = require('../services/mongooseSqlPlugin');
queueCounterSchema.plugin(createMongooseSqlMirrorPlugin('QueueCounter'));

module.exports = mongoose.model('QueueCounter', queueCounterSchema);
