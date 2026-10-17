const test = require("node:test");
const assert = require("node:assert/strict");
const { generateAnswerFromKnowledge, NO_SUPPORTED_ANSWER } = require("./answerGeneration");

const originalFetch = global.fetch;
let requestBody;

test.after(() => {
  global.fetch = originalFetch;
});

function mockOllama(answer) {
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: answer } }) };
  };
}

test("no matching references use the LLM's general knowledge prompt", async () => {
  mockOllama("Hello! How can I help?");

  const answer = await generateAnswerFromKnowledge("hello", []);

  assert.equal(answer, "Hello! How can I help?");
  assert.match(requestBody.messages[0].content, /general knowledge questions directly/i);
  assert.doesNotMatch(requestBody.messages[0].content, /Database references:/i);
});

test("matching references use the database-grounded prompt", async () => {
  mockOllama("Follow the listed enrollment steps.");
  const references = [{
    category: "Enrollment",
    question: "How do I enroll?",
    answer: "Submit the enrollment form to the Registrar."
  }];

  await generateAnswerFromKnowledge("How do I enroll?", references);

  assert.match(requestBody.messages[0].content, /only facts supported by the database references/i);
  assert.match(requestBody.messages[0].content, /Submit the enrollment form to the Registrar/);
  assert.equal(NO_SUPPORTED_ANSWER, "NO_SUPPORTED_ANSWER");
});