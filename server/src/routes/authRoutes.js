const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, optionalAuth } = require("../middlewares/authMiddleware");


const {
  register,
  requestRegistrationOtp,
  verifyRegistrationOtp,
  login,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
  getCurrentUser,
  logout,
  startGoogleLogin,
  googleCallback
} = require("../controllers/authController");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Try again later."
  }
});

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password recovery attempts. Try again later." }
});

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many registration verification attempts. Try again later." }
});

router.post("/register/request-otp", registrationLimiter, requestRegistrationOtp);
router.post("/register/verify-otp", registrationLimiter, verifyRegistrationOtp);
router.post("/register", registrationLimiter, register);
router.post("/login", authLimiter, login);
router.post("/forgot-password", recoveryLimiter, requestPasswordReset);
router.post("/verify-reset-otp", recoveryLimiter, verifyPasswordResetOtp);
router.post("/reset-password", recoveryLimiter, resetPassword);
router.get("/google", startGoogleLogin);
router.get("/google/callback", googleCallback);
router.get("/me", optionalAuth, getCurrentUser);
router.post("/logout", logout);


module.exports = router;
