const express = require("express");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const ConversationVersion = require("../models/ConversationVersion");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const items = await Conversation.find({ owner: req.user._id })
      .select("title createdAt updatedAt messages")
      .sort({ updatedAt: -1 })
      .lean();
    return res.json(items.map(({ _id, title, createdAt, updatedAt, messages }) => ({
      id: _id, title, createdAt, updatedAt, messageCount: messages.length
    })));
  } catch {
    return res.status(500).json({ error: "Unable to retrieve conversations" });
  }
});

router.post("/", async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "New conversation";
  if (!title || title.length > 120) return res.status(400).json({ error: "Title must be 1 to 120 characters" });
  try {
    const conversation = await Conversation.create({ owner: req.user._id, title });
    return res.status(201).json({ id: conversation._id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messages: [] });
  } catch {
    return res.status(500).json({ error: "Unable to create conversation" });
  }
});

router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid conversation ID" });
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, owner: req.user._id }).lean();
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const versionFilter = { conversation: conversation._id, owner: req.user._id };
    if (req.query.messageId) {
      if (!mongoose.isValidObjectId(req.query.messageId)) return res.status(400).json({ error: "Invalid message ID" });
      versionFilter.editedMessageId = req.query.messageId;
    }
    const versions = await ConversationVersion.find(versionFilter)
      .select("versionNumber createdAt editedMessageId")
      .sort({ versionNumber: 1 })
      .lean();
    const requestedVersion = Number(req.query.version || 0);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 0 || requestedVersion > versions.length) {
      return res.status(400).json({ error: "Invalid conversation version" });
    }
    let messages = conversation.messages;
    if (requestedVersion > 0) {
      const version = await ConversationVersion.findOne({
        conversation: conversation._id,
        owner: req.user._id,
        versionNumber: versions[requestedVersion - 1].versionNumber
      }).lean();
      if (!version) return res.status(404).json({ error: "Conversation version not found" });
      messages = version.messages;
    }
    return res.json({
      id: conversation._id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages,
      versionIndex: requestedVersion,
      versionCount: versions.length + 1,
      versions: versions.map(({ versionNumber, createdAt, editedMessageId }) => ({ versionNumber, createdAt, editedMessageId: editedMessageId.toString() }))
    });
  } catch {
    return res.status(500).json({ error: "Unable to retrieve conversation" });
  }
});

router.patch("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid conversation ID" });
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title || title.length > 120) return res.status(400).json({ error: "Title must be 1 to 120 characters" });
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      { $set: { title } },
      { new: true, runValidators: true }
    ).select("title updatedAt");
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    return res.json({ id: conversation._id, title: conversation.title, updatedAt: conversation.updatedAt });
  } catch {
    return res.status(500).json({ error: "Unable to rename conversation" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid conversation ID" });
  try {
    const deleted = await Conversation.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
    if (!deleted) return res.status(404).json({ error: "Conversation not found" });
    await ConversationVersion.deleteMany({ conversation: deleted._id, owner: req.user._id });
    return res.json({ message: "Conversation deleted" });
  } catch {
    return res.status(500).json({ error: "Unable to delete conversation" });
  }
});

module.exports = router;
