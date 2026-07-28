const crypto = require("crypto");

function generateSessionToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  generateSessionToken,
  hashToken,
};
