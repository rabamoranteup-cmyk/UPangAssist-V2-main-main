const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const dns = require("node:dns");
const KnowledgeEntry = require("./models/KnowledgeEntry");

const COLLECTION_NAME = "chatbot_knowledge";
const DEFAULT_LOCAL_URI = "mongodb://127.0.0.1:27017/upang-assist";

function cleanEntry(document) {
  const category = typeof document.category === "string" ? document.category.trim() : "";
  const question = typeof document.question === "string" ? document.question.trim() : "";
  const answer = typeof document.answer === "string" ? document.answer.trim() : "";

  if (!category || !question || !answer) {
    throw new Error(`Local knowledge entry ${document._id} is missing category, question, or answer`);
  }
  if (category.length > 100 || question.length > 500 || answer.length > 10000) {
    throw new Error(`Local knowledge entry ${document._id} exceeds the Atlas schema field limits`);
  }

  return {
    category,
    question,
    answer,
    lastUpdated: typeof document.lastUpdated === "string" && document.lastUpdated
      ? document.lastUpdated
      : new Date().toISOString().slice(0, 10)
  };
}

async function syncLocalKnowledgeToAtlas() {
  const atlasUri = process.env.MONGODB_URI;
  const localUri = process.env.LOCAL_MONGODB_URI || DEFAULT_LOCAL_URI;
  if (!atlasUri) throw new Error("MONGODB_URI is missing from server/.env");
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  let localConnection;
  try {
    await mongoose.connect(atlasUri);
    localConnection = await mongoose.createConnection(localUri).asPromise();

    const collections = await localConnection.db.listCollections(
      { name: COLLECTION_NAME },
      { nameOnly: true }
    ).toArray();
    if (collections.length === 0) {
      throw new Error(`Local collection ${COLLECTION_NAME} was not found in the configured local database`);
    }

    const sourceEntries = await localConnection.db.collection(COLLECTION_NAME).find({}).toArray();
    if (sourceEntries.length === 0) {
      console.log(`Local collection ${COLLECTION_NAME} is empty; nothing to sync.`);
      return;
    }

    const operations = sourceEntries.map((document) => {
      const entry = cleanEntry(document);
      return {
        updateOne: {
          filter: { category: entry.category, question: entry.question },
          update: { $setOnInsert: entry },
          upsert: true
        }
      };
    });

    const result = await KnowledgeEntry.bulkWrite(operations, { ordered: true });
    console.log(
      `Knowledge sync complete: ${sourceEntries.length} local entries checked, ` +
      `${result.upsertedCount} inserted into Atlas, ${result.matchedCount} already present.`
    );
  } finally {
    if (localConnection) await localConnection.close();
    await mongoose.disconnect();
  }
}

syncLocalKnowledgeToAtlas().catch((error) => {
  console.error("Knowledge sync failed:", error.message);
  process.exitCode = 1;
});
