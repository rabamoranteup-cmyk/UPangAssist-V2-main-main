const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, optionalAuth } = require("../middlewares/authMiddleware");


const {
  requestRegistrationOtp,
  getPendingRegistration,
  resendRegistrationOtp,
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

function registrationLimiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res) {
      const resetAt = req.rateLimit?.resetTime?.getTime();
      const retryAfterSeconds = resetAt
        ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      return res.status(429).json({
        error: "Too many registration verification attempts. Try again later.",
        retryAfterSeconds
      });
    }
  });
}

// Keep endpoint counters separate: page restoration and OTP verification should
// not consume the budget for starting a registration or requesting a new code.
const registrationRequestLimiter = registrationLimiter({ windowMs: 15 * 60 * 1000, limit: 10 });
const registrationVerificationLimiter = registrationLimiter({ windowMs: 15 * 60 * 1000, limit: 10 });
const registrationResendLimiter = registrationLimiter({ windowMs: 15 * 60 * 1000, limit: 10 });
const registrationSessionLimiter = registrationLimiter({ windowMs: 60 * 1000, limit: 60 });

router.post("/register/request-otp", registrationRequestLimiter, requestRegistrationOtp);
router.get("/register/pending", registrationSessionLimiter, getPendingRegistration);
router.post("/register/resend-otp", registrationResendLimiter, resendRegistrationOtp);
router.post("/register/verify-otp", registrationVerificationLimiter, verifyRegistrationOtp);
router.post("/login", authLimiter, login);
router.post("/forgot-password", recoveryLimiter, requestPasswordReset);
router.post("/verify-reset-otp", recoveryLimiter, verifyPasswordResetOtp);
router.post("/reset-password", recoveryLimiter, resetPassword);
router.get("/google", startGoogleLogin);
router.get("/google/callback", googleCallback);
router.get("/me", optionalAuth, getCurrentUser);
router.post("/logout", logout);


module.exports = router;
