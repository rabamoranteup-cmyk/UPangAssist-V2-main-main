const crypto = require("crypto");
const argon2 = require("argon2");
const User = require("../models/User");
const PendingRegistration = require("../models/PendingRegistration");
const {
  normalizeEmail,
  isAllowedSchoolEmail
} = require("../utils/emailPolicy");
const { createAccessToken } = require("../utils/jwt");
const { sendRecoveryOtp, sendRegistrationOtp, describeRecoveryEmailError } = require("../utils/recoveryEmail");

const RECOVERY_RESPONSE = "If an active account matches that PHINMA email, a password reset code has been sent.";
const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_WAIT_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const REGISTRATION_OTP_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_RESEND_WAIT_MS = 60 * 1000;
const REGISTRATION_TOKEN_TTL_MS = 10 * 60 * 1000;


async function getCurrentUser(req, res) {
  return res.status(200).json({
    user: req.user ? toSafeUser(req.user) : null
  });
}

function hashRecoveryValue(value) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(value).digest("hex");
}

async function findRecoveryUser(email) {
  return findUserByNormalizedEmail(
    email,
    "+resetOtpHash +resetOtpExpiresAt +resetOtpRequestedAt +resetOtpAttempts +resetTokenHash +resetTokenExpiresAt"
  );
}

async function requestPasswordReset(req, res) {
  const email = normalizeEmail(req.body?.email);
  if (!isAllowedSchoolEmail(email)) return res.status(200).json({ message: RECOVERY_RESPONSE });

  try {
    const user = await findRecoveryUser(email);
    if (!user || user.status !== "active") return res.status(200).json({ message: RECOVERY_RESPONSE });
    const now = Date.now();
    if (user.resetOtpRequestedAt && now - user.resetOtpRequestedAt.getTime() < OTP_RESEND_WAIT_MS) {
      return res.status(200).json({ message: RECOVERY_RESPONSE });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashRecoveryValue(`${email}:${otp}`);
    const otpExpiresAt = new Date(now + OTP_TTL_MS);
    const issueResult = await User.updateOne({ _id: user._id }, {
      $set: { resetOtpHash: otpHash, resetOtpExpiresAt: otpExpiresAt, resetOtpRequestedAt: new Date(now), resetOtpAttempts: 0 },
      $unset: { resetTokenHash: 1, resetTokenExpiresAt: 1 }
    });
    if (!issueResult.matchedCount) return res.status(200).json({ message: RECOVERY_RESPONSE });

    try {
      await sendRecoveryOtp(email, otp);
    } catch (mailError) {
      await User.updateOne({ _id: user._id, resetOtpHash: otpHash }, {
        $unset: { resetOtpHash: 1, resetOtpExpiresAt: 1, resetOtpRequestedAt: 1 },
        $set: { resetOtpAttempts: 0 }
      });
      const mailFailure = describeRecoveryEmailError(mailError);
      console.error(`Password reset email delivery failed (${mailFailure.code}): ${mailFailure.message}`);
      return res.status(503).json({ error: mailFailure.message });
    }
    return res.status(200).json({ message: RECOVERY_RESPONSE });
  } catch (error) {
    console.error("Password reset request failed:", error.message);
    return res.status(500).json({ error: "Unable to process password reset request" });
  }
}

async function verifyPasswordResetOtp(req, res) {
  const email = normalizeEmail(req.body?.email);
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!isAllowedSchoolEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: "Enter a valid PHINMA email and six-digit code" });
  }

  try {
    const user = await findRecoveryUser(email);
    if (!user || user.status !== "active" || !user.resetOtpHash || !user.resetOtpExpiresAt || user.resetOtpExpiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "The code is invalid or expired. Request a new code and try again." });
    }
    if ((user.resetOtpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      await User.updateOne({ _id: user._id, resetOtpHash: user.resetOtpHash }, {
        $unset: { resetOtpHash: 1, resetOtpExpiresAt: 1 }
      });
      return res.status(400).json({ error: "Too many incorrect attempts. Request a new code." });
    }

    const expected = Buffer.from(user.resetOtpHash, "hex");
    const received = Buffer.from(hashRecoveryValue(`${email}:${otp}`), "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      const attemptResult = await User.updateOne({ _id: user._id, resetOtpHash: user.resetOtpHash }, { $inc: { resetOtpAttempts: 1 } });
      if (!attemptResult.matchedCount) return res.status(400).json({ error: "The code is invalid or expired. Request a new code and try again." });
      const attempts = (user.resetOtpAttempts || 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await User.updateOne({ _id: user._id, resetOtpHash: user.resetOtpHash }, {
          $unset: { resetOtpHash: 1, resetOtpExpiresAt: 1 }
        });
      }
      return res.status(400).json({ error: attempts >= OTP_MAX_ATTEMPTS
        ? "Too many incorrect attempts. Request a new code."
        : "The code is invalid or expired. Check the code and try again." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const verifyResult = await User.updateOne({
      _id: user._id,
      resetOtpHash: user.resetOtpHash,
      resetOtpExpiresAt: { $gt: new Date() }
    }, {
      $set: { resetTokenHash: hashRecoveryValue(resetToken), resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS), resetOtpAttempts: 0 },
      $unset: { resetOtpHash: 1, resetOtpExpiresAt: 1 }
    });
    if (!verifyResult.matchedCount) return res.status(400).json({ error: "The code is invalid or expired. Request a new code and try again." });
    return res.status(200).json({ resetToken });
  } catch (error) {
    console.error("Password reset code verification failed:", error.message);
    return res.status(500).json({ error: "Unable to verify reset code" });
  }
}

async function resetPassword(req, res) {
  const email = normalizeEmail(req.body?.email);
  const resetToken = typeof req.body?.resetToken === "string" ? req.body.resetToken : "";
  const password = req.body?.password;
  const confirmPassword = req.body?.confirmPassword;
  if (!isAllowedSchoolEmail(email) || resetToken.length !== 64) return res.status(400).json({ error: "Invalid or expired password reset session" });
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Password must contain between 8 and 128 characters" });
  }
  if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match" });

  try {
    const user = await findRecoveryUser(email);
    if (!user || user.status !== "active" || !user.resetTokenHash || !user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "Invalid or expired password reset session" });
    }
    const expected = Buffer.from(user.resetTokenHash, "hex");
    const received = Buffer.from(hashRecoveryValue(resetToken), "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(400).json({ error: "Invalid or expired password reset session" });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const resetResult = await User.updateOne({
      _id: user._id,
      resetTokenHash: user.resetTokenHash,
      resetTokenExpiresAt: { $gt: new Date() }
    }, {
      $set: { passwordHash, resetOtpAttempts: 0 },
      $unset: {
        resetOtpHash: 1,
        resetOtpExpiresAt: 1,
        resetOtpRequestedAt: 1,
        resetTokenHash: 1,
        resetTokenExpiresAt: 1
      }
    });
    if (!resetResult.modifiedCount) return res.status(400).json({ error: "Invalid or expired password reset session" });
    return res.status(200).json({ message: "Password reset successfully. Please sign in with your new password." });
  } catch (error) {
    console.error("Password reset failed:", error.message);
    return res.status(500).json({ error: "Unable to reset password" });
  }
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
    path: "/"
  };
}

function toSafeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    course: user.course,
    role: user.role,
    status: user.status
  };
}

function setAuthCookie(res, user) {
  const token = createAccessToken(user);
  const cookieName = process.env.COOKIE_NAME || "upang_access_token";

  res.cookie(cookieName, token, getCookieOptions());
}

async function findUserByNormalizedEmail(email, select = "") {
  let exactQuery = User.findOne({ email });
  if (select && exactQuery && typeof exactQuery.select === "function") exactQuery = exactQuery.select(select);
  const exactMatch = await exactQuery;
  if (exactMatch) return exactMatch;

  let fallbackQuery = User.findOne({
    $expr: {
      $eq: [
        { $toLower: { $trim: { input: { $convert: { input: "$email", to: "string", onError: "", onNull: "" } } } } },
        email
      ]
    }
  });
  if (select && fallbackQuery && typeof fallbackQuery.select === "function") fallbackQuery = fallbackQuery.select(select);
  return fallbackQuery;
}

function readRegistrationDetails(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = normalizeEmail(body?.email);
  const course = typeof body?.course === "string" ? body.course.trim() : "";
  const password = body?.password;
  const confirmPassword = body?.confirmPassword;
  if (!isAllowedSchoolEmail(email)) return { error: { status: 401, message: "Invalid email or password" } };
  if (!name || !email || !course || !password || !confirmPassword) {
    return { error: { status: 400, message: "Name, email, course, password, and confirmation are required" } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: { status: 400, message: "Enter a valid email address" } };
  if (name.length < 2 || name.length > 100) return { error: { status: 400, message: "Name must be between 2 and 100 characters" } };
  if (course.length > 150) return { error: { status: 400, message: "Course must not exceed 150 characters" } };
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { error: { status: 400, message: "Password must contain between 8 and 128 characters" } };
  }
  if (password !== confirmPassword) return { error: { status: 400, message: "Passwords do not match" } };
  return { details: { name, email, course, password } };
}

async function requestRegistrationOtp(req, res) {
  const result = readRegistrationDetails(req.body);
  if (result.error) return res.status(result.error.status).json({ error: result.error.message });
  const { name, email, course, password } = result.details;

  try {
    if (await findUserByNormalizedEmail(email)) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const existingPending = await PendingRegistration.findOne({ email }).select("+otpRequestedAt");
    if (existingPending?.otpRequestedAt && Date.now() - existingPending.otpRequestedAt.getTime() < REGISTRATION_RESEND_WAIT_MS) {
      return res.status(429).json({ error: "A verification code was sent recently. Please wait before requesting another." });
    }

    const now = Date.now();
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashRecoveryValue(`${email}:${otp}`);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const pending = await PendingRegistration.findOneAndUpdate({ email }, {
      $set: {
        name,
        email,
        course,
        passwordHash,
        otpHash,
        otpExpiresAt: new Date(now + REGISTRATION_OTP_TTL_MS),
        otpRequestedAt: new Date(now),
        otpAttempts: 0,
        expiresAt: new Date(now + REGISTRATION_OTP_TTL_MS)
      },
      $unset: { registrationTokenHash: 1, registrationTokenExpiresAt: 1 }
    }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });

    try {
      await sendRegistrationOtp(email, otp);
    } catch (mailError) {
      await PendingRegistration.deleteOne({ _id: pending._id, otpHash });
      const mailFailure = describeRecoveryEmailError(mailError);
      console.error(`Registration OTP delivery failed (${mailFailure.code}): ${mailFailure.message}`);
      return res.status(503).json({ error: mailFailure.message });
    }
    return res.status(200).json({ message: "A verification code has been sent to your PHINMA email." });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with this email already exists" });
    console.error("Registration OTP request failed:", error.message);
    return res.status(500).json({ error: "Unable to start account verification" });
  }
}

async function verifyRegistrationOtp(req, res) {
  const email = normalizeEmail(req.body?.email);
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!isAllowedSchoolEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: "Enter a valid PHINMA email and six-digit code" });
  }

  try {
    const pending = await PendingRegistration.findOne({ email }).select("+otpHash +otpExpiresAt +otpAttempts");
    if (!pending || !pending.otpHash || !pending.otpExpiresAt || pending.otpExpiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "The code is invalid or expired. Request a new code and try again." });
    }
    if ((pending.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      await PendingRegistration.updateOne({ _id: pending._id, otpHash: pending.otpHash }, {
        $unset: { otpHash: 1, otpExpiresAt: 1 }
      });
      return res.status(400).json({ error: "Too many incorrect attempts. Request a new code." });
    }

    const expected = Buffer.from(pending.otpHash, "hex");
    const received = Buffer.from(hashRecoveryValue(`${email}:${otp}`), "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      const attempt = (pending.otpAttempts || 0) + 1;
      const update = attempt >= OTP_MAX_ATTEMPTS
        ? { $inc: { otpAttempts: 1 }, $unset: { otpHash: 1, otpExpiresAt: 1 } }
        : { $inc: { otpAttempts: 1 } };
      await PendingRegistration.updateOne({ _id: pending._id, otpHash: pending.otpHash }, update);
      return res.status(400).json({ error: attempt >= OTP_MAX_ATTEMPTS
        ? "Too many incorrect attempts. Request a new code."
        : "The code is invalid or expired. Check the code and try again." });
    }

    const registrationToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS);
    const verified = await PendingRegistration.updateOne({
      _id: pending._id,
      otpHash: pending.otpHash,
      otpExpiresAt: { $gt: new Date() }
    }, {
      $set: {
        registrationTokenHash: hashRecoveryValue(registrationToken),
        registrationTokenExpiresAt: tokenExpiry,
        expiresAt: tokenExpiry,
        otpAttempts: 0
      },
      $unset: { otpHash: 1, otpExpiresAt: 1 }
    });
    if (!verified.matchedCount) return res.status(400).json({ error: "The code is invalid or expired. Request a new code and try again." });
    return res.status(200).json({ registrationToken });
  } catch (error) {
    console.error("Registration OTP verification failed:", error.message);
    return res.status(500).json({ error: "Unable to verify email address" });
  }
}

async function register(req, res) {
  const email = normalizeEmail(req.body?.email);
  const registrationToken = typeof req.body?.registrationToken === "string" ? req.body.registrationToken : "";
  if (!isAllowedSchoolEmail(email) || registrationToken.length !== 64) {
    return res.status(400).json({ error: "Verify your email before creating an account" });
  }

  try {
    const pending = await PendingRegistration.findOne({ email }).select("+passwordHash +registrationTokenHash +registrationTokenExpiresAt");
    if (!pending || !pending.registrationTokenHash || !pending.registrationTokenExpiresAt || pending.registrationTokenExpiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "Email verification expired. Please request a new code." });
    }
    const expected = Buffer.from(pending.registrationTokenHash, "hex");
    const received = Buffer.from(hashRecoveryValue(registrationToken), "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(400).json({ error: "Invalid email verification session" });
    }
    if (await findUserByNormalizedEmail(email)) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const user = await User.create({
      name: pending.name,
      email,
      course: pending.course,
      passwordHash: pending.passwordHash,
      role: "student",
      status: "active",
      lastLoginAt: new Date()
    });
    await PendingRegistration.deleteOne({ _id: pending._id, registrationTokenHash: pending.registrationTokenHash });
    setAuthCookie(res, user);
    return res.status(201).json({ user: toSafeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    console.error("Registration error:", error.message);
    return res.status(500).json({ error: "Unable to create account" });
  }
}

async function login(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isAllowedSchoolEmail(email)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const password = req.body?.password;
    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email }).select("+passwordHash _id name email course role status");
    if (!user || user.status !== "active" || typeof user.passwordHash !== "string" || !user.passwordHash.startsWith("$argon2")) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    user.lastLoginAt = new Date();
    await user.save();
    setAuthCookie(res, user);
    return res.status(200).json({ user: toSafeUser(user) });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ error: "Unable to log in" });
  }
}
async function getCurrentUser(req, res) {
  return res.status(200).json({
    user: req.user ? toSafeUser(req.user) : null
  });
}

function logout(req, res) {
  const cookieName = process.env.COOKIE_NAME || "upang_access_token";

  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });

  return res.status(204).send();
}

function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI
  };
}

function googleFailure(res, code) {
  const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  const destination = new URL("/", frontendOrigin);
  destination.searchParams.set("oauth_error", code);
  return res.redirect(destination.toString());
}

function startGoogleLogin(req, res) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    return googleFailure(res, "google_not_configured");
  }

  const state = crypto.randomBytes(32).toString("hex");
  res.cookie("upang_google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth/google"
  });

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("hd", "phinmaed.com");
  authorizationUrl.searchParams.set("prompt", "select_account");
  return res.redirect(authorizationUrl.toString());
}

async function googleCallback(req, res) {
  const stateCookie = req.cookies?.upang_google_oauth_state;
  res.clearCookie("upang_google_oauth_state", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google"
  });

  if (!stateCookie || typeof req.query.state !== "string" ||
      stateCookie.length !== req.query.state.length ||
      !crypto.timingSafeEqual(Buffer.from(stateCookie), Buffer.from(req.query.state))) {
    return googleFailure(res, "google_state_invalid");
  }
  if (req.query.error) {
    return googleFailure(res, req.query.error === "org_internal" ? "google_org_restricted" : "google_cancelled");
  }
  if (typeof req.query.code !== "string") {
    return googleFailure(res, "google_cancelled");
  }

  try {
    const { clientId, clientSecret, redirectUri } = getGoogleConfig();
    if (!clientId || !clientSecret || !redirectUri) {
      return googleFailure(res, "google_not_configured");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!tokenResponse.ok) return googleFailure(res, "google_failed");

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) return googleFailure(res, "google_failed");

    if (!tokens.id_token) return googleFailure(res, "google_failed");
    const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
    tokenInfoUrl.searchParams.set("id_token", tokens.id_token);
    const identityResponse = await fetch(tokenInfoUrl);
    if (!identityResponse.ok) return googleFailure(res, "google_failed");

    const identity = await identityResponse.json();
    const email = normalizeEmail(identity.email);
    const emailDomain = email.split("@").at(-1);
    if (identity.aud !== clientId ||
        !["accounts.google.com", "https://accounts.google.com"].includes(identity.iss) ||
        identity.email_verified !== "true" || emailDomain !== "phinmaed.com" || !isAllowedSchoolEmail(email)) {
      return googleFailure(res, "google_unverified");
    }

    const user = await findUserByNormalizedEmail(email);
    console.info("Google OAuth registered-user lookup", {
      googleEmail: identity.email,
      normalizedEmail: email,
      database: User.db.name || "not-connected",
      collection: User.collection.name,
      matched: Boolean(user)
    });
    if (!user || user.status !== "active") {
      return googleFailure(res, "google_account_unregistered");
    }

    user.lastLoginAt = new Date();
    await user.save();
    setAuthCookie(res, user);
    const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
    return res.redirect(new URL("/", frontendOrigin).toString());
  } catch (error) {
    console.error("Google OAuth error:", error.name);
    return googleFailure(res, "google_failed");
  }
}

module.exports = {
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
};
