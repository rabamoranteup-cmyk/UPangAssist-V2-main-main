const { createEmbedding, getKeywordRelevance } = require("./services/knowledgeIndex");

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

async function findSemanticReferences(question, references, options = {}) {
  if (!references.length) return [];

  const limit = options.limit ?? 3;
  const minScore = options.minScore ?? 0.48;
  const questionEmbedding = await createEmbedding(question);
  const scored = references
    .filter((reference) => Array.isArray(reference.embedding) && reference.embedding.length > 0)
    .map((reference) => ({
      reference,
      score: cosineSimilarity(questionEmbedding, reference.embedding),
      keywordScore: getKeywordRelevance(question, reference)
    }));

  return scored
    .filter((item) => item.score >= minScore)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map((item) => ({ ...item, semanticScore: item.score }));
}

module.exports = { findSemanticReferences, cosineSimilarity };
