const User = require("../models/User");
const { verifyAccessToken } = require("../utils/jwt");
const { isAllowedSchoolEmail } = require("../utils/emailPolicy");

async function authenticate(req, res, next, optional = false) {
  try {
    const cookieName = process.env.COOKIE_NAME || "upang_access_token";
    const token = req.cookies?.[cookieName];

    if (!token) {
      if (optional) {
        req.user = null;
        return next();
      }
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const payload = verifyAccessToken(token);


    const user = await User.findById(payload.sub).select(
      "_id name email course role status"
    );

    if (!user) {
      if (optional) {
        req.user = null;
        return next();
      }
      return res.status(401).json({
        error: "User account not found"
      });
    }

    const normalizedEmail = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!isAllowedSchoolEmail(normalizedEmail) || normalizedEmail.split("@").at(-1) !== "phinmaed.com") {
      if (optional) {
        req.user = null;
        return next();
      }
      return res.status(403).json({ error: "PHINMA email required" });
    }
    if (user.status !== "active") {
      if (optional) {
        req.user = null;
        return next();
      }
      return res.status(403).json({
        error: "User account is disabled"
      });
    }


    req.user = user;
    next();
  } catch {
    if (optional) {
      req.user = null;
      return next();
    }
    return res.status(401).json({
      error: "Invalid or expired authentication"
    });
  }
}

function requireAuth(req, res, next) {
  return authenticate(req, res, next);
}

function optionalAuth(req, res, next) {
  return authenticate(req, res, next, true);
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Insufficient permissions"
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole
};
