const KnowledgeEntry = require("../models/KnowledgeEntry");

let entries = [];
function getKnowledgeBase() { return entries; }

async function refreshKnowledgeBase() {
  entries = await KnowledgeEntry.find().sort({ createdAt: 1 }).lean();
  return entries;
}

async function initializeKnowledgeBase() {
  await refreshKnowledgeBase();
}

module.exports = { getKnowledgeBase, refreshKnowledgeBase, initializeKnowledgeBase };
