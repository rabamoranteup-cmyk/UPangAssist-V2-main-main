const mongoose = require("mongoose");

const savedMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true, trim: true, maxlength: 12000 },
  references: [{ category: String, question: String }],
  createdAt: { type: Date, default: Date.now }
});

const conversationVersionSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  versionNumber: { type: Number, required: true },
  editedMessageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  messages: { type: [savedMessageSchema], default: [] }
}, { timestamps: true });

conversationVersionSchema.index({ conversation: 1, versionNumber: -1 }, { unique: true });

module.exports = mongoose.model("ConversationVersion", conversationVersionSchema);
