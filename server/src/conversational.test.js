const test = require("node:test");
const assert = require("node:assert/strict");
const { getConversationalReply } = require("./services/conversationalService");

test("how are you inquiries return warm assistant well-being response", () => {
  const variations = [
    "how are you",
    "How are you?",
    "how are you doing",
    "how are you today?",
    "how r u",
    "how's it going",
    "kamusta",
    "kumusta ka"
  ];
  for (const q of variations) {
    const reply = getConversationalReply(q);
    assert.ok(reply, `Expected reply for "${q}"`);
    assert.match(reply, /UPangAssist/i);
    assert.match(reply, /doing well/i);
  }
});

test("common greetings return friendly UPang greeting", () => {
  const greetings = [
    "hi",
    "hello",
    "hey",
    "Hey there!",
    "good morning",
    "Good afternoon UPangAssist",
    "good day",
    "mabuhay"
  ];
  for (const g of greetings) {
    const reply = getConversationalReply(g);
    assert.ok(reply, `Expected reply for "${g}"`);
    assert.match(reply, /UPangAssist/i);
    assert.match(reply, /how can i help you/i);
  }
});

test("bot identity questions return description of role and capabilities", () => {
  const identityQueries = [
    "who are you",
    "what is your name",
    "what can you do",
    "how can you help me",
    "tell me about yourself",
    "introduce yourself"
  ];
  for (const query of identityQueries) {
    const reply = getConversationalReply(query);
    assert.ok(reply, `Expected reply for "${query}"`);
    assert.match(reply, /automated student assistant/i);
  }
});

test("gratitude and farewells receive polite closures", () => {
  assert.match(getConversationalReply("thank you"), /welcome/i);
  assert.match(getConversationalReply("thanks!"), /welcome/i);
  assert.match(getConversationalReply("salamat po"), /welcome/i);
  assert.match(getConversationalReply("goodbye"), /goodbye/i);
  assert.match(getConversationalReply("bye"), /goodbye/i);
});

test("unrelated or database-specific questions return null to allow knowledge retrieval", () => {
  const specificQuestions = [
    "Where is the Registrar's Office?",
    "How much is the tuition fee for BSCS?",
    "Can I apply for Hawak Kamay scholarship?",
    "Where is the CEA building located?",
    "What is the schedule for enrollment?",
    "What is the capital of France?"
  ];
  for (const q of specificQuestions) {
    const reply = getConversationalReply(q);
    assert.equal(reply, null, `Specific question "${q}" should not match greeting handler`);
  }
});
