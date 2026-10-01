const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const argon2 = require("argon2");
const dns = require("node:dns");
const mongoose = require("mongoose");
const readline = require("readline/promises");
const { stdin, stdout } = require("node:process");
const User = require("./models/User");
const { normalizeEmail, isAllowedSchoolEmail } = require("./utils/emailPolicy");

function askHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in an interactive terminal to enter the admin password securely"));
  }

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Admin creation cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0008" || character === "\u007f") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function findExistingEmail(email) {
  return User.findOne({
    $expr: {
      $eq: [
        { $toLower: { $trim: { input: { $convert: { input: "$email", to: "string", onError: "", onNull: "" } } } } },
        email
      ]
    }
  });
}

async function createAdmin() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing from server/.env");
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  const prompts = readline.createInterface({ input: stdin, output: stdout });
  let name;
  let email;
  let course;
  try {
    name = (await prompts.question("Admin name: ")).trim();
    email = normalizeEmail(await prompts.question("Admin PHINMA email: "));
    course = (await prompts.question("Department or course [Administration]: ")).trim() || "Administration";
  } finally {
    prompts.close();
  }

  if (name.length < 2 || name.length > 100) throw new Error("Name must be between 2 and 100 characters");
  if (!isAllowedSchoolEmail(email) || email.split("@").at(-1) !== "phinmaed.com") {
    throw new Error("Use an email address on the configured PHINMA domain");
  }
  if (course.length > 150) throw new Error("Department or course must not exceed 150 characters");

  const password = await askHidden("Admin password (input hidden): ");
  const confirmation = await askHidden("Confirm password (input hidden): ");
  if (password.length < 8 || password.length > 128) throw new Error("Password must contain between 8 and 128 characters");
  if (password !== confirmation) throw new Error("Passwords do not match");

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (await findExistingEmail(email)) {
      throw new Error("An account with this email already exists; no account was changed");
    }

    await User.create({
      name,
      email,
      course,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: "admin",
      status: "active"
    });
    console.log(`Admin account created for ${email}. No OTP was requested.`);
  } finally {
    await mongoose.disconnect();
  }
}

createAdmin().catch((error) => {
  console.error("Admin account creation failed:", error.message);
  process.exitCode = 1;
});
