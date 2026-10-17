const KnowledgeEntry = require("../models/KnowledgeEntry");
const { buildSearchKeywords, createEmbedding, createKnowledgeSearchFields } = require("./knowledgeIndex");

let entries = [];
let knowledgeBaseLoaded = false;
let lastRefreshAt = 0;
let refreshInFlight = null;
const KNOWLEDGE_CACHE_TTL_MS = 5000;
function getKnowledgeBase() { return entries; }

async function refreshKnowledgeBase({ force = false } = {}) {
  if (!force && knowledgeBaseLoaded && Date.now() - lastRefreshAt < KNOWLEDGE_CACHE_TTL_MS) {
    return entries;
  }
  if (refreshInFlight) {
    await refreshInFlight;
    if (!force) return entries;
  }
  refreshInFlight = KnowledgeEntry.find()
    .select("+searchKeywords +embedding")
    .sort({ createdAt: 1 })
    .lean()
    .then((freshEntries) => {
      entries = freshEntries;
      knowledgeBaseLoaded = true;
      lastRefreshAt = Date.now();
      return entries;
    })
    .finally(() => { refreshInFlight = null; });
  await refreshInFlight;
  return entries;
}

async function initializeKnowledgeBase() {
  await refreshKnowledgeBase({ force: true });
}

async function backfillKnowledgeSearchData() {
  await refreshKnowledgeBase({ force: true });
  const pending = entries.filter((entry) =>
    !entry.searchKeywords?.length || !entry.embedding?.length
  );
  if (!pending.length) return { total: entries.length, indexed: 0 };
  const requiresEmbeddings = pending.some((entry) => !entry.embedding?.length);
  if (requiresEmbeddings) {
    try {
      await createEmbedding("UPangAssist knowledge indexing check");
    } catch (error) {
      console.warn("Knowledge embeddings were not backfilled; keyword search remains available:", error.message);
      return { total: entries.length, indexed: 0 };
    }
  }
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pending.length) {
      const entry = pending[nextIndex++];
      const update = { searchKeywords: buildSearchKeywords(entry) };
      if (!entry.embedding?.length) {
        const fields = await createKnowledgeSearchFields(entry);
        if (fields.embedding?.length) update.embedding = fields.embedding;
      }
      await KnowledgeEntry.updateOne(
        { _id: entry._id, updatedAt: entry.updatedAt },
        { $set: update }
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker));
  await refreshKnowledgeBase({ force: true });
  return { total: entries.length, indexed: pending.length };
}

module.exports = {
  getKnowledgeBase,
  refreshKnowledgeBase,
  initializeKnowledgeBase,
  backfillKnowledgeSearchData
};
