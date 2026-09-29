const nodemailer = require("nodemailer");

function createRecoveryTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const missing = [];
  if (!host?.trim()) missing.push("SMTP_HOST");
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push("SMTP_PORT");
  if (!user?.trim()) missing.push("SMTP_USER");
  if (!pass?.trim()) missing.push("SMTP_PASS");
  if (missing.length) {
    const error = new Error(`Missing SMTP configuration: ${missing.join(", ")}`);
    error.code = "SMTP_CONFIG_MISSING";
    throw error;
  }

  const secureSetting = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (secureSetting && !["true", "false"].includes(secureSetting)) {
    const error = new Error("SMTP_SECURE must be true or false");
    error.code = "SMTP_CONFIG_INVALID";
    throw error;
  }
  const secure = secureSetting ? secureSetting === "true" : port === 465;
  return nodemailer.createTransport({
    host: host.trim(),
    port,
    secure,
    auth: { user: user.trim(), pass }
  });
}

function describeRecoveryEmailError(error) {
  if (error.code === "SMTP_CONFIG_MISSING") {
    return {
      code: error.code,
      message: `${error.message}. Add these settings to server/.env and restart the server.`
    };
  }
  if (error.code === "SMTP_CONFIG_INVALID") {
    return { code: error.code, message: `${error.message}. Check server/.env and restart the server.` };
  }
  if (error.code === "EAUTH" || error.responseCode === 535 || error.responseCode === 534) {
    return {
      code: "SMTP_AUTH_FAILED",
      message: "SMTP authentication failed. Check SMTP_USER and SMTP_PASS, and confirm SMTP AUTH is enabled for the sender account."
    };
  }
  if (["ECONNECTION", "ESOCKET", "ETIMEDOUT", "ETLS", "EDNS"].includes(error.code)) {
    return {
      code: "SMTP_CONNECTION_FAILED",
      message: "Could not connect securely to the SMTP server. Check SMTP_HOST, SMTP_PORT, and SMTP_SECURE."
    };
  }
  if (error.code === "EENVELOPE" || error.responseCode === 550 || error.responseCode === 553) {
    return {
      code: "SMTP_ADDRESS_REJECTED",
      message: "The SMTP server rejected the sender or recipient. Check SMTP_FROM is a verified address authorized for this account."
    };
  }
  return {
    code: "SMTP_DELIVERY_FAILED",
    message: "The SMTP server could not deliver the recovery email. Check the sender address and provider delivery settings."
  };
}

async function verifyRecoveryEmailTransport() {
  const transport = createRecoveryTransport();
  await transport.verify();
}

async function sendOtpEmail(email, otp, subject, context) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error("SMTP_FROM is not configured");
  await createRecoveryTransport().sendMail({
    from,
    to: email,
    subject,
    text: `${context} ${otp}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
    html: `<p>${context}</p><p style="font-size:24px;font-weight:bold;letter-spacing:5px">${otp}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`
  });
}

function sendRecoveryOtp(email, otp) {
  return sendOtpEmail(email, otp, "Your UPang Assist password reset code", "Your UPang Assist password reset code is:");
}

function sendRegistrationOtp(email, otp) {
  return sendOtpEmail(email, otp, "Verify your UPang Assist account", "Your UPang Assist account verification code is:");
}

module.exports = { sendRecoveryOtp, sendRegistrationOtp, verifyRecoveryEmailTransport, describeRecoveryEmailError };
