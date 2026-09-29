const jwt = require("jsonwebtoken");

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return process.env.JWT_SECRET;
}

function createAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString()
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
      issuer: "upang-assist",
      audience: "upang-assist-client"
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    issuer: "upang-assist",
    audience: "upang-assist-client"
  });
}

module.exports = {
  createAccessToken,
  verifyAccessToken
};
