const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const dns = require("node:dns");
const KnowledgeEntry = require("./models/KnowledgeEntry");
const entries = require("./data/universityGeneralKnowledge.json");

async function seedUniversityGeneralKnowledge() {
  const uri = process.env.MONGODB_URI || process.env.LOCAL_MONGODB_URI || "mongodb://127.0.0.1:27017/upang-assist";
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);

  if (dnsServers.length) dns.setServers(dnsServers);

  for (const [index, entry] of entries.entries()) {
    if (!entry.category || !entry.question || !entry.answer) {
      throw new Error(`Seed entry ${index + 1} is missing category, question, or answer`);
    }
    if (entry.category.length > 100 || entry.question.length > 500 || entry.answer.length > 10000) {
      throw new Error(`Seed entry ${index + 1} exceeds the knowledge schema field limits`);
    }
  }

  await mongoose.connect(uri);
  try {
    const operations = entries.map((entry) => ({
      updateOne: {
        filter: { category: entry.category, question: entry.question },
        update: { $set: { answer: entry.answer, lastUpdated: today } },
        upsert: true
      }
    }));
    const result = await KnowledgeEntry.bulkWrite(operations, { ordered: true });
    console.log(
      `General knowledge seed complete: ${entries.length} entries processed, ` +
      `${result.upsertedCount} inserted, ${result.modifiedCount} updated, ` +
      `${result.matchedCount - result.modifiedCount} unchanged.`
    );
  } finally {
    await mongoose.disconnect();
  }
}

seedUniversityGeneralKnowledge().catch((error) => {
  if (error.code === "ECONNREFUSED" && error.syscall === "querySrv") {
    console.error(
      "Knowledge seed failed: DNS could not resolve the MongoDB Atlas SRV record. " +
      "Check network DNS access, or set MONGODB_DNS_SERVERS in server/.env to reachable DNS resolver IPs. " +
      "For local seeding, temporarily remove MONGODB_URI and set LOCAL_MONGODB_URI."
    );
  } else {
    console.error("Knowledge seed failed:", error.message);
  }
  process.exitCode = 1;
});
