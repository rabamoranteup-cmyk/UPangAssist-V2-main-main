const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const PendingRegistration = require("./models/PendingRegistration");
const authController = require("./controllers/authController");
const nodemailer = require("nodemailer");
const { verifyRecoveryEmailTransport, describeRecoveryEmailError } = require("./utils/recoveryEmail");
const authRoutes = require("./routes/authRoutes");
const { requireAuth } = require("./middlewares/authMiddleware");

const originalEnv = {};
for (const key of ["JWT_SECRET", "ALLOWED_EMAIL_DOMAINS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "FRONTEND_ORIGIN", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
  originalEnv[key] = process.env[key];
}
process.env.JWT_SECRET = "test-only-secret";
process.env.ALLOWED_EMAIL_DOMAINS = "phinmaed.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client";
process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";
process.env.FRONTEND_ORIGIN = "http://localhost:5173";

const originalFetch = global.fetch;
const originalFindOne = User.findOne;
const originalUpdateOne = User.updateOne;
const originalCreate = User.create;
const originalPendingFindOne = PendingRegistration.findOne;
const originalPendingFindOneAndUpdate = PendingRegistration.findOneAndUpdate;
const originalPendingUpdateOne = PendingRegistration.updateOne;
const originalPendingDeleteOne = PendingRegistration.deleteOne;
const originalFindById = User.findById;
const originalCreateTransport = nodemailer.createTransport;
let tokenExchangeRedirectUri;

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(url) { this.redirectUrl = url; return this; },
    cookie(name, value, options) { this.cookieValue = { name, value, options }; return this; },
    clearCookie(name, options) { this.clearedCookie = { name, options }; return this; },
    send(body) { this.body = body; return this; }
  };
}

function googleRequest() {
  return { cookies: { upang_google_oauth_state: "valid-state" }, query: { state: "valid-state", code: "authorization-code" } };
}

function googleFetch(identity) {
  tokenExchangeRedirectUri = undefined;
  global.fetch = async (url, options = {}) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      tokenExchangeRedirectUri = new URLSearchParams(options.body).get("redirect_uri");
      return { ok: true, json: async () => ({ access_token: "access", id_token: "id-token" }) };
    }
    return { ok: true, json: async () => identity };
  };
}

function signedSession() {
  return jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET, {
    expiresIn: "1m", issuer: "upang-assist", audience: "upang-assist-client"
  });
}

test.after(() => {
  global.fetch = originalFetch;
  User.findOne = originalFindOne;
  User.updateOne = originalUpdateOne;
  User.create = originalCreate;
  User.findById = originalFindById;
  PendingRegistration.findOne = originalPendingFindOne;
  PendingRegistration.findOneAndUpdate = originalPendingFindOneAndUpdate;
  PendingRegistration.updateOne = originalPendingUpdateOne;
  PendingRegistration.deleteOne = originalPendingDeleteOne;
  nodemailer.createTransport = originalCreateTransport;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Google authorization uses the configured callback and route", () => {
  const res = response();
  authController.startGoogleLogin({}, res);
  const authorizationUrl = new URL(res.redirectUrl);
  const callbackLayer = authRoutes.stack.find((layer) => layer.route?.path === "/google/callback" && layer.route.methods.get);
  assert.ok(callbackLayer);
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), process.env.GOOGLE_REDIRECT_URI);
  assert.equal(authorizationUrl.searchParams.get("hd"), "phinmaed.com");
  assert.equal(new URL(process.env.GOOGLE_REDIRECT_URI).pathname, `/api/auth${callbackLayer.route.path}`);
});

test("verified registered PHINMA Google accounts can sign in", async () => {
  googleFetch({ aud: "test-google-client", iss: "https://accounts.google.com", email: "person@phinmaed.com", email_verified: "true", hd: "phinmaed.com" });
  const user = {
    _id: { toString: () => "user-1" }, name: "Student", email: "person@phinmaed.com", course: "BSCS", role: "student", status: "active",
    async save() { this.saved = true; }
  };
  User.findOne = async ({ email }) => email === user.email ? user : null;
  const res = response();
  await authController.googleCallback(googleRequest(), res);
  assert.equal(res.redirectUrl, "http://localhost:5173/");
  assert.equal(tokenExchangeRedirectUri, process.env.GOOGLE_REDIRECT_URI);
  assert.equal(user.saved, true);
  assert.ok(res.cookieValue);
});

test("matches stored email after trimming and lowercasing both sides", async () => {
  googleFetch({ aud: "test-google-client", iss: "https://accounts.google.com", email: "  Student@PHINMAED.COM ", email_verified: "true", hd: "phinmaed.com" });
  const storedUser = {
    _id: { toString: () => "user-2" }, name: "Student", email: " Student@PHINMAED.COM ", course: "BSCS", role: "student", status: "active",
    async save() { this.saved = true; }
  };
  let normalizedFallbackQuery;
  User.findOne = (query) => {
    if (query.email) return Promise.resolve(null);
    normalizedFallbackQuery = query;
    return Promise.resolve(storedUser);
  };
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const res = response();
    await authController.googleCallback(googleRequest(), res);
    assert.ok(res.cookieValue);
    assert.equal(storedUser.saved, true);
    assert.ok(normalizedFallbackQuery.$expr.$eq[0].$toLower.$trim);
  } finally {
    console.info = originalInfo;
  }
});

test("unregistered Google accounts remain rejected", async () => {
  googleFetch({ aud: "test-google-client", iss: "https://accounts.google.com", email: "person@phinmaed.com", email_verified: "true", hd: "phinmaed.com" });
  User.findOne = async () => null;
  const res = response();
  await authController.googleCallback(googleRequest(), res);
  assert.equal(new URL(res.redirectUrl).searchParams.get("oauth_error"), "google_account_unregistered");
  assert.equal(res.cookieValue, undefined);
});

test("rejects Google identities outside the approved PHINMA email domain", async () => {
  googleFetch({ aud: "test-google-client", iss: "https://accounts.google.com", email: "person@gmail.com", email_verified: "true", hd: "gmail.com" });
  User.findOne = async () => { throw new Error("Non-PHINMA identity must be rejected before lookup"); };
  const res = response();
  await authController.googleCallback(googleRequest(), res);
  assert.equal(new URL(res.redirectUrl).searchParams.get("oauth_error"), "google_unverified");
  assert.equal(res.cookieValue, undefined);
});

test("rejects invalid Google identity tokens", async () => {
  googleFetch({ aud: "another-client", iss: "https://accounts.google.com", email: "person@phinmaed.com", email_verified: "true" });
  User.findOne = async () => { throw new Error("Identity should be rejected before database lookup"); };
  const res = response();
  await authController.googleCallback(googleRequest(), res);
  assert.equal(new URL(res.redirectUrl).searchParams.get("oauth_error"), "google_unverified");
  assert.equal(res.cookieValue, undefined);
});

test("protected APIs reject missing or invalid sessions and accept an active database user", async () => {
  const activeUser = { _id: "user-1", email: "person@phinmaed.com", status: "active" };
  const call = async (token, user) => {
    User.findById = () => ({ select: async () => user });
    const req = { cookies: token ? { upang_access_token: token } : {} };
    const res = response();
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  };
  assert.equal((await call(null, activeUser)).res.statusCode, 401);
  const invalid = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET, { expiresIn: "1m", issuer: "wrong", audience: "upang-assist-client" });
  assert.equal((await call(invalid, activeUser)).res.statusCode, 401);
  assert.equal((await call(signedSession(), null)).res.statusCode, 401);
  assert.equal((await call(signedSession(), { ...activeUser, status: "disabled" })).res.statusCode, 403);
  assert.equal((await call(signedSession(), activeUser)).nextCalled, true);
});

test("logout clears the auth cookie", () => {
  const res = response();
  authController.logout({}, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.clearedCookie.name, "upang_access_token");
});

test("PHINMA password recovery sends OTP, verifies it, and resets the password", async () => {
  process.env.SMTP_HOST = "smtp.test.invalid";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "sender@phinmaed.com";
  process.env.SMTP_PASS = "test-password";
  process.env.SMTP_FROM = "UPang Assist <sender@phinmaed.com>";

  let sentEmail;
  nodemailer.createTransport = (config) => {
    assert.equal(config.host, "smtp.test.invalid");
    assert.equal(config.port, 587);
    return { sendMail: async (mail) => { sentEmail = mail; } };
  };

  const user = {
    _id: "recovery-user-1",
    email: "student@phinmaed.com",
    status: "active",
    resetOtpAttempts: 0
  };
  User.findOne = ({ email }) => ({
    select: async () => email === user.email ? user : null
  });
  User.updateOne = async (filter, update) => {
    if (filter._id !== user._id || (filter.resetOtpHash && filter.resetOtpHash !== user.resetOtpHash)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (filter.resetOtpExpiresAt?.$gt && user.resetOtpExpiresAt <= filter.resetOtpExpiresAt.$gt) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (filter.resetTokenExpiresAt?.$gt && user.resetTokenExpiresAt <= filter.resetTokenExpiresAt.$gt) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    for (const [key, value] of Object.entries(update.$set || {})) user[key] = value;
    for (const [key, value] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + value;
    for (const key of Object.keys(update.$unset || {})) delete user[key];
    return { matchedCount: 1, modifiedCount: 1 };
  };

  const requested = response();
  await authController.requestPasswordReset({ body: { email: " Student@PHINMAED.COM " } }, requested);
  assert.equal(requested.statusCode, 200);
  assert.equal(sentEmail.to, user.email);
  assert.match(sentEmail.subject, /password reset code/i);
  const otp = sentEmail.text.match(/code is:?\s*(\d{6})/)[1];
  assert.notEqual(user.resetOtpHash, otp);

  const verified = response();
  await authController.verifyPasswordResetOtp({ body: { email: user.email, otp } }, verified);
  assert.equal(verified.statusCode, 200);
  assert.equal(typeof verified.body.resetToken, "string");
  assert.equal(user.resetOtpHash, undefined);

  const reset = response();
  await authController.resetPassword({ body: {
    email: user.email,
    resetToken: verified.body.resetToken,
    password: "NewSecurePassword123!",
    confirmPassword: "NewSecurePassword123!"
  } }, reset);
  assert.equal(reset.statusCode, 200);
  assert.match(reset.body.message, /reset successfully/i);
  assert.equal(typeof user.passwordHash, "string");
  assert.equal(user.resetTokenHash, undefined);
});

test("SMTP diagnostics identify missing configuration without exposing values", async () => {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    await assert.rejects(verifyRecoveryEmailTransport(), (error) => {
      const failure = describeRecoveryEmailError(error);
      assert.equal(failure.code, "SMTP_CONFIG_MISSING");
      assert.match(failure.message, /SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS/);
      assert.doesNotMatch(failure.message, /test-password|sender@/);
      return true;
    });
    const authFailure = describeRecoveryEmailError({ code: "EAUTH", message: "redacted" });
    assert.equal(authFailure.code, "SMTP_AUTH_FAILED");
    assert.match(authFailure.message, /SMTP_USER and SMTP_PASS/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("signup requires a PHINMA email OTP before creating a MongoDB account", async () => {
  process.env.SMTP_HOST = "smtp.test.invalid";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "sender@phinmaed.com";
  process.env.SMTP_PASS = "test-password";
  process.env.SMTP_FROM = "UPang Assist <sender@phinmaed.com>";

  let sentEmail;
  let pending;
  let createdAccount = null;
  let pendingId = 0;
  nodemailer.createTransport = () => ({ sendMail: async (mail) => { sentEmail = mail; } });
  User.findOne = () => ({
    select: async () => null,
    then(resolve, reject) { return Promise.resolve(null).then(resolve, reject); }
  });
  User.create = async (details) => {
    createdAccount = { _id: "new-user-1", ...details };
    return createdAccount;
  };
  PendingRegistration.findOne = () => ({ select: async () => pending });
  PendingRegistration.findOneAndUpdate = async (filter, update) => {
    pending = { _id: `pending-${++pendingId}`, ...update.$set };
    return pending;
  };
  PendingRegistration.updateOne = async (filter, update) => {
    if (!pending || filter._id !== pending._id || (filter.otpHash && filter.otpHash !== pending.otpHash)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    for (const [key, value] of Object.entries(update.$set || {})) pending[key] = value;
    for (const key of Object.keys(update.$unset || {})) delete pending[key];
    return { matchedCount: 1, modifiedCount: 1 };
  };
  PendingRegistration.deleteOne = async (filter) => {
    if (pending && filter._id === pending._id) pending = null;
    return { deletedCount: 1 };
  };

  const details = { name: "Student User", email: "New.Student@phinmaed.com", course: "BSCS", password: "SecurePassword123!", confirmPassword: "SecurePassword123!" };
  const rejected = response();
  await authController.requestRegistrationOtp({ body: { ...details, email: "new.student@gmail.com" } }, rejected);
  assert.equal(rejected.statusCode, 401);
  assert.equal(sentEmail, undefined);
  assert.equal(createdAccount, null);

  const requested = response();
  await authController.requestRegistrationOtp({ body: details }, requested);
  assert.equal(requested.statusCode, 200);
  assert.equal(sentEmail.to, "new.student@phinmaed.com");
  const otp = sentEmail.text.match(/code is:\s*(\d{6})/)[1];
  assert.equal(createdAccount, null);

  const noOtpToken = response();
  await authController.register({ body: { email: details.email } }, noOtpToken);
  assert.equal(noOtpToken.statusCode, 400);
  assert.equal(createdAccount, null);

  const verified = response();
  await authController.verifyRegistrationOtp({ body: { email: details.email, otp } }, verified);
  assert.equal(verified.statusCode, 200);
  assert.equal(createdAccount, null);

  const registered = response();
  await authController.register({ body: { email: details.email, registrationToken: verified.body.registrationToken } }, registered);
  assert.equal(registered.statusCode, 201);
  assert.equal(createdAccount.email, "new.student@phinmaed.com");
  assert.ok(createdAccount.passwordHash.startsWith("$argon2"));
  assert.ok(registered.cookieValue);
  assert.equal(pending, null);
});
