const express = require("express");
const mongoose = require("mongoose");
const KnowledgeEntry = require("../models/KnowledgeEntry");
const { requireAuth, requireRole } = require("../middlewares/authMiddleware");
const { refreshKnowledgeBase } = require("../services/knowledgeBase");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

function validateEntry(body = {}) {
  const entry = {};
  for (const field of ["category", "question", "answer"]) {
    entry[field] = typeof body[field] === "string" ? body[field].trim() : "";
  }
  if (!entry.category || !entry.question || !entry.answer) return { error: "Category, question, and answer are required" };
  if (entry.category.length > 100 || entry.question.length > 500 || entry.answer.length > 10000) return { error: "One or more fields exceed their length limit" };
  entry.lastUpdated = new Date().toISOString().slice(0, 10);
  return { entry };
}

router.get("/", async (_req, res) => {
  try { return res.json(await KnowledgeEntry.find().sort({ category: 1, question: 1 }).lean()); }
  catch { return res.status(500).json({ error: "Unable to load chatbot knowledge" }); }
});

router.post("/", async (req, res) => {
  const { entry, error } = validateEntry(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const created = await KnowledgeEntry.create(entry);
    await refreshKnowledgeBase();
    return res.status(201).json(created);
  } catch { return res.status(500).json({ error: "Unable to save knowledge entry" }); }
});

router.patch("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid knowledge entry ID" });
  const { entry, error } = validateEntry(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const updated = await KnowledgeEntry.findByIdAndUpdate(req.params.id, entry, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: "Knowledge entry not found" });
    await refreshKnowledgeBase();
    return res.json(updated);
  } catch { return res.status(500).json({ error: "Unable to update knowledge entry" }); }
});

router.delete("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid knowledge entry ID" });
  try {
    const deleted = await KnowledgeEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Knowledge entry not found" });
    await refreshKnowledgeBase();
    return res.json({ message: "Knowledge entry deleted" });
  } catch { return res.status(500).json({ error: "Unable to delete knowledge entry" }); }
});

module.exports = router;
