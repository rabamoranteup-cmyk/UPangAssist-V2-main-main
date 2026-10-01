const NO_SUPPORTED_ANSWER = "NO_SUPPORTED_ANSWER";

function formatKnowledgeContext(references) {
  return references.map((reference, index) => [
    `Database reference ${index + 1}`,
    `Category: ${reference.category}`,
    `Question/topic: ${reference.question}`,
    `Answer: ${reference.answer}`
  ].join("\n")).join("\n\n");
}

function getSystemPrompt(references) {
  if (references.length === 0) {
    return "You are UPangAssist, a helpful and conversational assistant. Answer greetings, casual conversation, and general knowledge questions directly using your general knowledge. Do not invent current or specific PHINMA University of Pangasinan details such as enrollment procedures, deadlines, fees, policies, or contact information. If asked for those details without a database reference, say that you cannot verify them.";
  }

  const context = formatKnowledgeContext(references);
  return `You are UPangAssist. Answer the user's question naturally and clearly using only facts supported by the database references below. You may paraphrase, combine, and organize those facts so the answer feels conversational. Do not add outside knowledge, assumptions, policies, dates, fees, contact details, or other facts. If the references do not support an answer, reply with exactly ${NO_SUPPORTED_ANSWER} and nothing else.\n\nDatabase references:\n${context}`;
}

async function generateAnswerFromKnowledge(question, references = []) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: getSystemPrompt(references) },
        { role: "user", content: question }
      ],
      options: { num_predict: 180, temperature: 0.2 },
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed (${response.status})`);
  }
  const data = await response.json();
  const answer = data.message?.content?.trim();
  if (!answer) throw new Error("Ollama returned an empty answer");
  return answer;
}

module.exports = { generateAnswerFromKnowledge, NO_SUPPORTED_ANSWER };