const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { verifyRecoveryEmailTransport, describeRecoveryEmailError } = require("./utils/recoveryEmail");

verifyRecoveryEmailTransport()
  .then(() => {
    console.log("SMTP configuration loaded and authentication verified successfully.");
    process.exitCode = 0;
  })
  .catch((error) => {
    const failure = describeRecoveryEmailError(error);
    console.error(`SMTP verification failed (${failure.code}): ${failure.message}`);
    process.exitCode = 1;
  });
