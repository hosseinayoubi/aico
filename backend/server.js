import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { WebSocketServer } from "ws";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PROACTIVE_SYSTEM_BASE =
  "You are a real-time proactive copilot. You receive partial live transcript every 1.5 seconds. " +
  "Produce ONLY one short helpful suggestion (max 12 words) OR return an empty string if nothing useful. " +
  "Do not repeat earlier suggestions.";

// ✅ مدل درست طبق داشبورد شما (Available models)
const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

// ✅ اگر کسی اشتباه grok-4.1-... داد، این خودش اصلاح می‌کنه
function normalizeModelName(model) {
  const m = (model || "").trim();
  if (!m) return DEFAULT_MODEL;

  // تبدیل grok-4.1-fast-... به grok-4-1-fast-...
  // و همچنین هر نقطه‌ای را در بخش نسخه با خط‌تیره جایگزین می‌کند
  return m
    .replace("grok-4.1-", "grok-4-1-")
    .replace("grok-4.1", "grok-4-1");
}

async function callXai({ text, userContext }) {
  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) {
    return { ok: false, status: 500, error: "XAI_API_KEY is missing" };
  }

  const model = normalizeModelName(process.env.XAI_MODEL || DEFAULT_MODEL);
  const temperature = 0.1;
  const max_tokens = 24;

  const cleanText = (text ?? "").toString().trim();
  if (!cleanText) {
    return { ok: false, status: 400, error: "Missing text" };
  }

  const cleanUserContext = (userContext ?? "").toString().trim();
  const systemContent = cleanUserContext
    ? `${PROACTIVE_SYSTEM_BASE}\n\nContext:\n${cleanUserContext}`
    : PROACTIVE_SYSTEM_BASE;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: cleanText },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("xAI error:", response.status, data);
    return {
      ok: false,
      status: response.status,
      error: "xAI request failed",
      details: data,
    };
  }

  const reply = data?.choices?.[0]?.message?.content ?? "";
  return { ok: true, reply: String(reply) };
}

app.post("/chat", async (req, res) => {
  try {
    const { text, system } = req.body || {};
    const out = await callXai({ text, userContext: system });

    if (!out.ok) {
      return res
        .status(out.status || 500)
        .json({ error: out.error, details: out.details });
    }

    return res.json({ reply: out.reply });
  } catch (err) {
    console.error("Backend error:", err);
    return res.status(500).json({ error: "Backend failed" });
  }
});

// HTTP + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", status: "connected" }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString() || "{}");
      const out = await callXai({ text: msg.text, userContext: msg.system });

      if (!out.ok) {
        ws.send(JSON.stringify({ type: "error", error: out.error }));
        return;
      }

      ws.send(JSON.stringify({ type: "reply", reply: out.reply }));
    } catch (err) {
      console.error("WS backend error:", err);
      ws.send(JSON.stringify({ type: "error", error: "Backend failed" }));
    }
  });
});

server.listen(PORT, () => {
  const effectiveModel = normalizeModelName(process.env.XAI_MODEL || DEFAULT_MODEL);
  console.log("✅ HTTP+WS listening on", PORT);
  console.log("✅ Using model:", effectiveModel);
});
