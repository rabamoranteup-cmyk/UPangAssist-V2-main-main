const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },

    course: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
    },

    passwordHash: {
      type: String,
      required: true,
      select: false
    },

    role: {
      type: String,
      enum: ["student", "admin"],
      default: "student",
      required: true
    },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      required: true
    },

    lastLoginAt: {
      type: Date,
      default: null
    },

    resetOtpHash: { type: String, select: false },
    resetOtpExpiresAt: { type: Date, select: false },
    resetOtpRequestedAt: { type: Date, select: false },
    resetOtpAttempts: { type: Number, default: 0, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("User", userSchema);
