const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const dns = require("node:dns");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { requireAuth } = require("./middlewares/authMiddleware");
const taskRoutes = require("./routes/taskRoutes");
const authRoutes = require("./routes/authRoutes");
const { findSemanticReferences } = require("./semanticSearch");

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
    allowedHeaders: ["Content-Type"]
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

function getKnowledgeBase() {
  const filePath = path.join(__dirname, "../data/knowledgeBase.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

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
      const officeWords = new Set(getSearchWords(reference.office).map(normalizeSearchWord));
      const sourceWords = new Set(getSearchWords(reference.source).map(normalizeSearchWord));
      const score = words.reduce((total, word) => {
        const wordScore = Math.max(
          questionWords.has(word) ? 8 : 0,
          categoryWords.has(word) ? 6 : 0,
          answerWords.has(word) ? 2 : 0,
          officeWords.has(word) ? 2 : 0,
          sourceWords.has(word) ? 1 : 0
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

function findSpecificBuildingReference(question) {
  const lower = question.toLowerCase();
  const campusReference = getKnowledgeBase().find((reference) =>
    (reference.category || "").toLowerCase().includes("campus navigation")
  );

  if (!campusReference) return null;

  const buildingNames = [
    "main building",
    "cea building",
    "cite building",
    "university library",
    "university gymnasium"
  ];
  const requestedBuilding = buildingNames.find((building) => lower.includes(building));

  if (!requestedBuilding) return null;

  const buildingEntry = campusReference.answer
    .split("â€¢")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(`${requestedBuilding}:`));

  if (!buildingEntry) return null;

  return {
    ...campusReference,
    answer: `â€¢ ${buildingEntry}`
  };
}

function findUnverifiedBuildingName(question) {
  const match = question.match(/\b([a-z0-9-]{3,})\s+building\b/i);
  const buildingName = match?.[1]?.toLowerCase();
  if (!buildingName || ["the", "this", "that"].includes(buildingName)) return null;

  const verifiedText = getKnowledgeBase()
    .map((reference) => [reference.category, reference.question, reference.answer].filter(Boolean).join(" "))
    .join(" ")
    .toLowerCase();

  return verifiedText.includes(buildingName) ? null : match[1];
}

function formatReferences(references) {
  if (references.length === 0) {
    return "No matching verified UPang reference was found in the knowledge base.";
  }

  return references.map((reference, index) => [
    `Reference ${index + 1}`,
    `Category: ${reference.category || "Not specified"}`,
    `Question/topic: ${reference.question || "Not specified"}`,
    `Information: ${reference.answer || "Not specified"}`,
    `Source: ${reference.source || "Not specified"}`,
    `Page/section: ${reference.page || "Not specified"}`,
    `Related office: ${reference.office || "Not specified"}`
  ].join("\n")).join("\n\n");
}


async function streamAnswerWithOllama(question, referenceContext, res) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";

  const systemInstruction = `You are UPangAssist, a university information assistant for PHINMA University of Pangasinan (UPang).
Answer student questions factually, warmly, and concisely using the verified UPang references below.
Keep answers brief and straight to the point (under 3-4 sentences when possible).
If you lack enough information, clearly say that there is no verified reference for the specific question and recommend contacting the official UPang office.

Verified UPang references:
${referenceContext}`;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: question }
      ],
      options: {
        num_predict: 160,
        temperature: 0.3
      },
      stream: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          res.write(parsed.message.content);
        }
      } catch {
        // ignore incomplete JSON chunk
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer);
      if (parsed.message?.content) {
        res.write(parsed.message.content);
      }
    } catch {
      // ignore
    }
  }

  res.end();
}

async function generateAnswerWithOllama(question, referenceContext) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2:1b";

  const systemInstruction = `You are UPangAssist, a helpful and student-friendly university information assistant for PHINMA University of Pangasinan (UPang).
Answer strictly using the verified UPang references supplied below. Never invent or hallucinate policies, requirements, fees, dates, or contact details.
Keep your answers brief and straight to the point (under 3-4 sentences). Include source where available.

Verified UPang references:
${referenceContext}`;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: question }
      ],
      options: {
        num_predict: 160,
        temperature: 0.3
      },
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.message?.content?.trim();
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const wantStream = req.body?.stream === true || req.query?.stream === "true";

  if (!question) {
    return res.status(400).json({ error: "question is required" });
  }

  const unverifiedBuilding = findUnverifiedBuildingName(question);
  if (unverifiedBuilding) {
    const message = `I do not have a verified UPang reference for the ${unverifiedBuilding} Building location. Please contact Campus Administration or the relevant college office for the current location.`;
    if (wantStream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(message);
    }
    return res.json({ text: message, provider: "verified_reference_check" });
  }

  const specificBuilding = findSpecificBuildingReference(question);
  if (specificBuilding) {
    const specificBuildingText = `${specificBuilding.answer}\n\n*Source: ${specificBuilding.source || "UPang Campus Directory"} (${specificBuilding.page || "Campus Map"})*`;
    if (wantStream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(specificBuildingText);
    }
    return res.json({ text: specificBuildingText, provider: "instant_knowledge_base" });
  }

  // Semantic search handles paraphrases; keyword search remains a safe fallback.
  let references = findRelevantReferences(question);
  try {
    const semanticReferences = await findSemanticReferences(question, getKnowledgeBase());
    if (semanticReferences.length > 0) references = semanticReferences;
  } catch (error) {
    console.warn("Semantic search unavailable; using keyword search:", error.message);
  }
  const referenceContext = formatReferences(references);
  const provider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();

  try {
    // 2. Streamed generation with local LLM for real-time word-by-word display
    if (provider === "ollama" && wantStream) {
      return await streamAnswerWithOllama(question, referenceContext, res);
    }

    let text = "";
    if (provider === "ollama") {
      text = await generateAnswerWithOllama(question, referenceContext);
    } else {
      text = references.length > 0
        ? `${references[0].answer}\n\n*Source: ${references[0].source || "UPang Knowledge Base"} (${references[0].office || "Official Office"})*`
        : "I do not have enough verified information to answer this question. Please contact the appropriate UPang office for assistance.";
    }

    if (!text) {
      return res.status(502).json({ error: "Chatbot returned an empty answer" });
    }

    return res.json({ text, provider });
  } catch (error) {
    console.error(`Chat error (${provider}):`, error.message);

    // If local LLM is starting up or temporarily unavailable, use direct reference fallback
    if (references.length > 0) {
      const top = references[0];
      const fallbackText = `${top.answer}\n\n*Office: ${top.office || "Official Office"} | Source: ${top.source || "Official UPang Guidelines"}*`;
      if (wantStream) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.end(fallbackText);
      }
      return res.json({ text: fallbackText, fallback: true });
    }

    // Keep the chat usable when the optional AI provider is offline and the
    // question has no matching knowledge-base entry.
    const unavailableText = "I couldn't find a verified UPang answer for that question right now. I can help with enrollment, Registrar services, tuition payments, scholarships, campus locations, and student wellness services. For other concerns, please contact the appropriate official UPang office.";
    if (wantStream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(unavailableText);
    }
    return res.json({ text: unavailableText, fallback: true });
  }
});


if (!process.env.MONGODB_URI) {
  console.error("MongoDB connection error: MONGODB_URI is not configured in server/.env");
  process.exit(1);
}

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);

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
    app.listen(process.env.PORT || 3000, () => {
      console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
    });
  } catch (error) {
    console.error("MongoDB connection error:", error.name);
    process.exit(1);
  }
}

startServer();
