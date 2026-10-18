function sanitizeChatMessage(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<\/?(?:script|style|iframe|object|embed|svg|math|link|meta|base)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/javascript\s*:/gi, "")
    .trim();
}

module.exports = { sanitizeChatMessage };
