const documentEmbeddingCache = new Map();

function referenceToText(reference) {
  return [
    reference.category,
    reference.question,
    reference.answer,
    reference.source,
    reference.page,
    reference.office
  ].filter(Boolean).join("\n");
}

function cosineSimilarity(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    return 0;
  }

  let dotProduct = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;

  for (let index = 0; index < first.length; index += 1) {
    dotProduct += first[index] * second[index];
    firstMagnitude += first[index] ** 2;
    secondMagnitude += second[index] ** 2;
  }

  if (!firstMagnitude || !secondMagnitude) return 0;
  return dotProduct / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
}

async function createEmbedding(text) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Ollama embedding request failed");
  }

  return data.embeddings?.[0] || null;
}

async function getDocumentEmbedding(reference) {
  const text = referenceToText(reference);
  if (!documentEmbeddingCache.has(text)) {
    documentEmbeddingCache.set(text, createEmbedding(text));
  }
  return documentEmbeddingCache.get(text);
}

async function findSemanticReferences(question, references, options = {}) {
  if (!references.length) return [];

  const limit = options.limit || 2;
  const minScore = options.minScore || 0.5;
  const questionEmbedding = await createEmbedding(question);
  if (!questionEmbedding) return [];

  const scored = await Promise.all(references.map(async (reference) => ({
    reference,
    score: cosineSimilarity(questionEmbedding, await getDocumentEmbedding(reference))
  })));

  return scored
    .filter((item) => item.score >= minScore)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map((item) => item.reference);
}

module.exports = { findSemanticReferences, cosineSimilarity };
