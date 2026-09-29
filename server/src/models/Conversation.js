const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true, trim: true, maxlength: 12000 },
  references: [{
    category: String,
    question: String
  }],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const conversationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  messages: { type: [messageSchema], default: [] }
}, { timestamps: true });

conversationSchema.index({ owner: 1, updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
