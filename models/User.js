const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    prefix: {
      type: String,
      trim: true,
      maxlength: 30,
      default: '',
    },
    firstName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    fullName: {
      type: String,
      trim: true,
      default: '',
    },
    nickname: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    age: {
      type: Number,
      min: 15,
      max: 100,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },
    role: {
      type: String,
      enum: ['admin', 'manager', 'kitchen', 'waiter'],
      required: true,
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

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
