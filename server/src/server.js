const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const mongoose = require("mongoose");
const dns = require("node:dns");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { requireAuth } = require("./middlewares/authMiddleware");
const taskRoutes = require("./routes/taskRoutes");
const authRoutes = require("./routes/authRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const Conversation = require("./models/Conversation");
const ConversationVersion = require("./models/ConversationVersion");
const { findSemanticReferences } = require("./semanticSearch");
const { getKnowledgeBase, refreshKnowledgeBase, initializeKnowledgeBase } = require("./services/knowledgeBase");
const knowledgeRoutes = require("./routes/knowledgeRoutes");

const app = express();

const frontendOrigin =
  process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["X-Conversation-Id"]
  })
);

app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

const ignoredSearchWords = new Set([
  "about", "after", "also", "and", "are", "can", "could", "does", "for",
  "from", "how", "is", "it", "me", "my", "of", "please", "the", "there",
  "this", "to", "what", "when", "where", "which", "who", "with", "would",
  "you", "your", "campus", "student", "students"
]);

const searchWordAliases = {
  wear: ["dress", "uniform"],
  wearing: ["dress", "uniform"],
  clothes: ["dress", "uniform"],
  clothing: ["dress", "uniform"],
  aid: ["scholarship", "financial"],
  hk: ["hawak", "kamay", "scholarship"]
};

function getSearchWords(value) {
  const words = (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]{2,}/g)
    ?.filter((word) => !ignoredSearchWords.has(word)) || [];

  return words.flatMap((word) => [word, ...(searchWordAliases[word] || [])]);
}

function normalizeSearchWord(word) {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  return word;
}

function findRelevantReferences(question) {
  const words = [...new Set(getSearchWords(question).map(normalizeSearchWord))];

  return getKnowledgeBase()
    .map((reference) => {
      const questionWords = new Set(getSearchWords(reference.question).map(normalizeSearchWord));
      const categoryWords = new Set(getSearchWords(reference.category).map(normalizeSearchWord));
      const answerWords = new Set(getSearchWords(reference.answer).map(normalizeSearchWord));
      const score = words.reduce((total, word) => {
        const wordScore = Math.max(
          questionWords.has(word) ? 8 : 0,
          categoryWords.has(word) ? 6 : 0,
          answerWords.has(word) ? 2 : 0
        );
        return total + (wordScore > 0 ? wordScore + 4 : 0);
      }, 0);
      return { reference, score };
    })
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, 3)
    .map((item) => item.reference);
}

async function getOrCreateConversation(req, question) {
  const conversationId = req.body?.conversationId;
  if (conversationId !== undefined && !mongoose.isValidObjectId(conversationId)) {
    const error = new Error("Invalid conversation ID");
    error.status = 400;
    throw error;
  }
  if (conversationId) {
    const conversation = await Conversation.findOne({ _id: conversationId, owner: req.user._id });
    if (!conversation) {
      const error = new Error("Conversation not found");
      error.status = 404;
      throw error;
    }
    return conversation;
  }
  return Conversation.create({ owner: req.user._id, title: question.slice(0, 120) });
}

async function saveChatTurn(conversation, question, answer, references = []) {
  conversation.messages.push(
    { role: "user", content: question },
    {
      role: "assistant",
      content: answer,
      references: references.map(({ category, question: topic }) => ({ category, question: topic }))
    }
  );
  await conversation.save();
}

const NO_SUPPORTED_ANSWER = "NO_SUPPORTED_ANSWER";

function formatKnowledgeContext(references) {
  return references.map((reference, index) => [
    `Database reference ${index + 1}`,
    `Category: ${reference.category}`,
    `Question/topic: ${reference.question}`,
    `Answer: ${reference.answer}`
  ].join("\n")).join("\n\n");
}

async function generateAnswerFromKnowledge(question, references) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";
  const context = formatKnowledgeContext(references);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `You are UPangAssist. Answer the user's question naturally and clearly using only facts supported by the database references below. You may paraphrase, combine, and organize those facts so the answer feels conversational. Do not add outside knowledge, assumptions, policies, dates, fees, contact details, or other facts. If the references do not support an answer, reply with exactly ${NO_SUPPORTED_ANSWER} and nothing else.\n\nDatabase references:\n${context}`
        },
        { role: "user", content: question }
      ],
      options: { num_predict: 180, temperature: 0.2 },
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed (${response.status})`);
  }
  const data = await response.json();
  const answer = data.message?.content?.trim();
  if (!answer) throw new Error("Ollama returned an empty answer");
  return answer;
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";

  if (!question || question.length > 12000) {
    return res.status(400).json({ error: "question is required and must be at most 12000 characters" });
  }

  try {
    await refreshKnowledgeBase();
  } catch (error) {
    console.error("Knowledge database read failed:", error.message);
    return res.status(503).json({ error: "Knowledge database unavailable" });
  }

  let references = findRelevantReferences(question);
  try {
    const semanticReferences = await findSemanticReferences(question, getKnowledgeBase());
    if (semanticReferences.length > 0) references = semanticReferences;
  } catch (error) {
    console.warn("Semantic search unavailable; using keyword search:", error.message);
  }

  if (references.length === 0) {
    return res.status(204).end();
  }

  let answer;
  try {
    answer = await generateAnswerFromKnowledge(question, references);
  } catch (error) {
    console.error("Database-grounded answer generation failed:", error.message);
    return res.status(503).json({ error: "Unable to generate an answer from the knowledge database" });
  }
  if (answer === NO_SUPPORTED_ANSWER) {
    return res.status(204).end();
  }

  let conversation;
  try {
    conversation = await getOrCreateConversation(req, question);
    await saveChatTurn(conversation, question, answer, references);
    return res.json({ text: answer, provider: "database_grounded", conversationId: conversation._id });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Unable to save conversation" });
  }
});

app.post("/api/conversations/:id/edit", requireAuth, async (req, res) => {
  const { id } = req.params;
  const messageId = req.body?.messageId;
  const editedContent = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(messageId)) {
    return res.status(400).json({ error: "Invalid conversation or message ID" });
  }
  if (!editedContent || editedContent.length > 12000) {
    return res.status(400).json({ error: "Edited message must be 1 to 12000 characters" });
  }

  try {
    const conversation = await Conversation.findOne({ _id: id, owner: req.user._id });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const messageIndex = conversation.messages.findIndex((message) => message._id.toString() === messageId);
    if (messageIndex < 0 || conversation.messages[messageIndex].role !== "user") {
      return res.status(404).json({ error: "User message not found in this conversation" });
    }
    const latestUserMessageIndex = conversation.messages.findLastIndex((message) => message.role === "user");
    if (messageIndex !== latestUserMessageIndex) {
      return res.status(409).json({ error: "Only the latest user message can be edited" });
    }

    await refreshKnowledgeBase();
    let references = findRelevantReferences(editedContent);
    try {
      const semanticReferences = await findSemanticReferences(editedContent, getKnowledgeBase());
      if (semanticReferences.length) references = semanticReferences;
    } catch (error) {
      console.warn("Semantic search unavailable during message edit:", error.message);
    }

    if (references.length === 0) {
      return res.status(204).end();
    }
    let answer;
    try {
      answer = await generateAnswerFromKnowledge(editedContent, references);
    } catch (error) {
      console.error("Database-grounded answer regeneration failed:", error.message);
      return res.status(503).json({ error: "Unable to generate an answer from the knowledge database" });
    }
    if (answer === NO_SUPPORTED_ANSWER) {
      return res.status(204).end();
    }

    const priorMessages = conversation.messages.map((message) => message.toObject({ depopulate: true }));
    const previousVersionCount = await ConversationVersion.countDocuments({ conversation: conversation._id, owner: req.user._id });
    const savedVersion = await ConversationVersion.create({
      conversation: conversation._id,
      owner: req.user._id,
      versionNumber: previousVersionCount + 1,
      editedMessageId: conversation.messages[messageIndex]._id,
      messages: priorMessages
    });

    try {
      conversation.messages.splice(messageIndex + 1);
      conversation.messages[messageIndex].content = editedContent;
      conversation.messages.push({ role: "assistant", content: answer, references });
      if (messageIndex === 0) conversation.title = editedContent.slice(0, 120);
      await conversation.save();
    } catch (error) {
      await ConversationVersion.deleteOne({ _id: savedVersion._id, owner: req.user._id });
      throw error;
    }

    return res.json({
      id: conversation._id,
      title: conversation.title,
      messages: conversation.messages,
      versionIndex: 0,
      versionCount: previousVersionCount + 2,
      createdVersion: previousVersionCount + 1
    });
  } catch (error) {
    console.error("Conversation edit failed:", error.message);
    return res.status(500).json({ error: "Unable to edit conversation and regenerate its answer" });
  }
});


if (!process.env.MONGODB_URI) {
  console.error("MongoDB connection error: MONGODB_URI is not configured in server/.env");
  process.exit(1);
}

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/admin/knowledge", knowledgeRoutes);

async function startServer() {
  try {
    const configuredDnsServers = (process.env.MONGODB_DNS_SERVERS || "")
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean);
    if (configuredDnsServers.length) {
      dns.setServers(configuredDnsServers);
      console.log(`MongoDB DNS servers configured: ${configuredDnsServers.join(", ")}`);
    }

    // Do not accept requests until Mongoose is connected. Otherwise a request
    // can be handled while writes are still being buffered for a connection.
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB connected to ${mongoose.connection.name}`);
    await initializeKnowledgeBase();
    console.log(`Chatbot knowledge loaded (${getKnowledgeBase().length} entries)`);
    app.listen(process.env.PORT || 3000, () => {
      console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
    });
  } catch (error) {
    // Include the connection failure reason while masking credentials if a
    // MongoDB URI is ever included in a driver error message.
    const redactMongoCredentials = (value) => String(value).replace(
      /(mongodb(?:\+srv)?:\/\/[^:\s/@]+:)[^@\s]+@/gi,
      "$1[REDACTED]@"
    );
    console.error(
      "MongoDB connection error:",
      error.name,
      redactMongoCredentials(error.message)
    );
    if (error.reason?.message) {
      console.error("MongoDB connection details:", redactMongoCredentials(error.reason.message));
    }
    process.exit(1);
  }
}

startServer();



