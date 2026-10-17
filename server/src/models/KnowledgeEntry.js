const mongoose = require("mongoose");

const knowledgeEntrySchema = new mongoose.Schema({
  category: { type: String, required: true, trim: true, maxlength: 100 },
  question: { type: String, required: true, trim: true, maxlength: 500 },
  answer: { type: String, required: true, trim: true, maxlength: 10000 },
  searchKeywords: { type: [String], default: [], select: false },
  embedding: { type: [Number], default: [], select: false },
  lastUpdated: { type: String, default: () => new Date().toISOString().slice(0, 10) }
}, { timestamps: true, collection: "chatbot_knowledge" });

module.exports = mongoose.model("KnowledgeEntry", knowledgeEntrySchema);
