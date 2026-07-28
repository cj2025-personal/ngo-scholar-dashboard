const argon2 = require("argon2");

const { ApiError } = require("./api-error");

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTIONS);
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch (error) {
    return false;
  }
}

function assertStrongPassword(password) {
  if (typeof password !== "string") {
    throw new ApiError(400, "A password is required.");
  }

  const issues = [];

  if (password.length < 12) {
    issues.push("at least 12 characters");
  }

  if (!/[a-z]/.test(password)) {
    issues.push("one lowercase letter");
  }

  if (!/[A-Z]/.test(password)) {
    issues.push("one uppercase letter");
  }

  if (!/[0-9]/.test(password)) {
    issues.push("one number");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    issues.push("one special character");
  }

  if (issues.length > 0) {
    throw new ApiError(
      400,
      `Password must include ${issues.join(", ")}.`,
    );
  }
}

async function isPasswordReused(password, hashes) {
  for (const hash of hashes) {
    if (await verifyPassword(password, hash)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  assertStrongPassword,
  hashPassword,
  isPasswordReused,
  verifyPassword,
};
