const mongoSanitize = require("express-mongo-sanitize");

/**
 * Reject MongoDB operator/path keys before the sanitizer can remove them.
 * Walk arrays and nested objects so payloads cannot hide a prohibited key.
 */
function rejectNoSqlKeys(req, res, next) {
  const stringFields = new Set(["email", "username", "googleId"]);
  const hasInvalidKey = (value) => {
    if (Array.isArray(value)) return value.some(hasInvalidKey);
    if (!value || typeof value !== "object") return false;

    return Object.entries(value).some(([key, child]) => {
      if (key.startsWith("$") || key.includes(".")) return true;
      if (stringFields.has(key) && (typeof child !== "string")) return true;
      return hasInvalidKey(child);
    });
  };

  if ([req.body, req.query, req.params].some(hasInvalidKey)) {
    return res.status(400).json({ error: "Invalid payload format." });
  }
  return next();
}

// Use the package's sanitizer directly on the parsed body. Its Express
// middleware assigns req.query, which is a read-only getter in Express 5.
// Query strings and route params are checked by rejectNoSqlKeys above.
function sanitizeMongoInput(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = mongoSanitize.sanitize(req.body);
  }
  return next();
}

module.exports = { rejectNoSqlKeys, sanitizeMongoInput };
