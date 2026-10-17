const ignoredSearchWords = new Set([
  "about", "after", "also", "and", "are", "can", "could", "does", "for",
  "from", "how", "is", "it", "me", "my", "of", "please", "the", "there",
  "this", "to", "what", "when", "where", "which", "who", "with", "would",
  "you", "your", "campus", "student", "students"
]);

const searchWordAliases = {
  wear: ["dress", "uniform"],
  wearing: ["dress", "uniform"],
  clothes: ["dress", "uniform"],
  clothing: ["dress", "uniform"],
  aid: ["scholarship", "financial"],
  hk: ["hawak", "kamay", "scholarship"]
};

function normalizeSearchWord(word) {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  return word;
}

function getSearchWords(value) {
  const words = (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]{2,}/g)
    ?.filter((word) => !ignoredSearchWords.has(word)) || [];
  return words.flatMap((word) => [word, ...(searchWordAliases[word] || [])])
    .map(normalizeSearchWord);
}

function buildSearchKeywords(entry) {
  return [...new Set(getSearchWords(`${entry.category || ""} ${entry.question || ""} ${entry.answer || ""}`))];
}

function getKeywordRelevance(question, entry) {
  const queryWords = [...new Set(getSearchWords(question))];
  if (!queryWords.length) return 0;
  const indexedWords = new Set(
    Array.isArray(entry.searchKeywords) && entry.searchKeywords.length
      ? entry.searchKeywords
      : buildSearchKeywords(entry)
  );
  const matchingWords = queryWords.reduce((count, word) => count + (indexedWords.has(word) ? 1 : 0), 0);
  return matchingWords / queryWords.length;
}

function getEmbeddingText(entry) {
  return [entry.category, entry.question, entry.answer].filter(Boolean).join("\n");
}

async function createEmbedding(text) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ollama embedding request failed (${response.status})`);
  const embedding = data.embeddings?.[0];
  if (!Array.isArray(embedding) || !embedding.length || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("Ollama returned an invalid embedding");
  }
  return embedding;
}

async function createKnowledgeSearchFields(entry) {
  const fields = { searchKeywords: buildSearchKeywords(entry), embedding: [] };
  try {
    fields.embedding = await createEmbedding(getEmbeddingText(entry));
  } catch (error) {
    console.warn(`Could not generate a knowledge embedding for "${entry.question}":`, error.message);
  }
  return fields;
}

module.exports = {
  buildSearchKeywords,
  createEmbedding,
  createKnowledgeSearchFields,
  getEmbeddingText,
  getKeywordRelevance
};
