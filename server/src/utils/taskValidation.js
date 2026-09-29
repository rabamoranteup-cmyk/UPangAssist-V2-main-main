const TASK_TITLE_MAX_LENGTH = 120;
const TASK_DESCRIPTION_MAX_LENGTH = 2000;

function validateTaskPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }

  const allowedFields = new Set(["title", "description", "completed"]);
  const unknownField = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unknownField) return { error: `Unexpected field: ${unknownField}` };

  const values = {};
  for (const field of ["title", "description"]) {
    if (!Object.hasOwn(body, field)) {
      if (!partial) return { error: `${field} is required` };
      continue;
    }

    if (typeof body[field] !== "string") {
      return { error: `${field} must be a string` };
    }

    const value = body[field].trim();
    const maxLength = field === "title" ? TASK_TITLE_MAX_LENGTH : TASK_DESCRIPTION_MAX_LENGTH;
    if (!value) return { error: `${field} cannot be empty` };
    if (value.length > maxLength) {
      return { error: `${field} must be ${maxLength} characters or fewer` };
    }
    values[field] = value;
  }

  if (Object.hasOwn(body, "completed")) {
    if (typeof body.completed !== "boolean") {
      return { error: "completed must be a boolean" };
    }
    values.completed = body.completed;
  }

  if (partial && Object.keys(values).length === 0) {
    return { error: "Provide at least one field to update" };
  }

  return { values };
}

module.exports = {
  TASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
  validateTaskPayload
};
