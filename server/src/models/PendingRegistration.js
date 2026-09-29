const mongoose = require("mongoose");

const pendingRegistrationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  course: { type: String, required: true, trim: true, maxlength: 150 },
  passwordHash: { type: String, required: true, select: false },
  otpHash: { type: String, select: false },
  otpExpiresAt: { type: Date, select: false },
  otpRequestedAt: { type: Date, select: false },
  otpAttempts: { type: Number, default: 0, select: false },
  registrationTokenHash: { type: String, select: false },
  registrationTokenExpiresAt: { type: Date, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

module.exports = mongoose.model("PendingRegistration", pendingRegistrationSchema);
