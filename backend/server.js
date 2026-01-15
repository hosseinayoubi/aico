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

app.get("/health", (req, res) => res.json({ ok: true }));

// -----------------------------
// Prompts / Modes
// -----------------------------
const PROACTIVE_SYSTEM_BASE =
  "You are a real-time proactive copilot. You receive partial live transcript. " +
  "Produce ONLY one short helpful suggestion (max 12 words) OR return an empty string if nothing useful. " +
  "Do not repeat earlier suggestions.";

// ✅ Deep: سریع ولی منطقی + ساختارمند
const DEEP_SYSTEM_BASE =
  "You are an attentive AI listener. Answer fast but thoughtfully. " +
  "First give a short direct answer (1-2 sentences). " +
  "Then, if useful, add a 'Details' section with bullet points. " +
  "If the input is incomplete, ask ONE short clarifying question.";

// ✅ مدل درست طبق داشبورد
const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

// اگر کسی اشتباه grok-4.1-... داد، خودکار اصلاح می‌کنه
function normalizeModelName(model) {
  const m = (model || "").trim();
  if (!m) return DEFAULT_MODEL;
  return m.replace("grok-4.1-", "grok-4-1-").replace("grok-4.1", "grok-4-1");
}

function clamp(n, min, max) {
  const x = Number.isFinite(Number(n)) ? Number(n) : min;
  return Math.max(min, Math.min(max, x));
}

function buildSystemPrompt({ mode, userContext }) {
  const cleanCtx = (userContext ?? "").toString().trim();
  const base = mode === "deep" ? DEEP_SYSTEM_BASE : PROACTIVE_SYSTEM_BASE;
  return cleanCtx ? `${base}\n\nContext:\n${cleanCtx}` : base;
}

function getGenParams({ mode }) {
  if (mode === "deep") {
    // ✅ منطقی‌تر و سریع‌تر از 0.7/512
    return { temperature: 0.4, max_tokens: 320 };
  }
  return { temperature: 0.2, max_tokens: 32 };
}

// -----------------------------
// xAI Call
// -----------------------------
async function callXai({ text, userContext, mode }) {
  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) {
    return { ok: false, status: 500, error: "XAI_API_KEY is missing" };
  }

  const model = normalizeModelName(process.env.XAI_MODEL || DEFAULT_MODEL);

  const cleanText = (text ?? "").toString().trim();
  if (!cleanText) {
    return { ok: false, status: 400, error: "Missing text" };
  }

  const normalizedMode = (mode || "proactive").toString().trim().toLowerCase();
  const finalMode = normalizedMode === "deep" ? "deep" : "proactive";

  const systemContent = buildSystemPrompt({
    mode: finalMode,
    userContext,
  });

  const { temperature, max_tokens } = getGenParams({ mode: finalMode });
  const safeMaxTokens = clamp(max_tokens, 16, 800);

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: safeMaxTokens,
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

// -----------------------------
// HTTP endpoint (optional)
// -----------------------------
app.post("/chat", async (req, res) => {
  try {
    const { text, system, mode } = req.body || {};
    const out = await callXai({ text, userContext: system, mode });

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

// -----------------------------
// HTTP + WebSocket
// -----------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  ws.send(
    JSON.stringify({
      type: "status",
      status: "connected",
      model: normalizeModelName(process.env.XAI_MODEL || DEFAULT_MODEL),
    })
  );

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString() || "{}");

      // expected: { type:"chat", text, system, mode, requestId }
      if (!msg || typeof msg !== "object") {
        ws.send(JSON.stringify({ type: "error", error: "Invalid message" }));
        return;
      }
      if (msg.type !== "chat") {
        ws.send(JSON.stringify({ type: "error", error: "Unknown type" }));
        return;
      }

      const requestId = (msg.requestId ?? "").toString();
      const mode = (msg.mode ?? "proactive").toString();
      const text = msg.text;
      const system = msg.system;

      const out = await callXai({ text, userContext: system, mode });

      if (!out.ok) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: out.error,
            status: out.status,
            requestId,
            details: out.details,
          })
        );
        return;
      }

      ws.send(
        JSON.stringify({
          type: "reply",
          reply: out.reply,
          requestId,
          mode: mode === "deep" ? "deep" : "proactive",
        })
      );
    } catch (err) {
      console.error("WS backend error:", err);
      ws.send(JSON.stringify({ type: "error", error: "Backend failed" }));
    }
  });
});

// Ping/Pong heartbeat (Railway/proxies)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  const effectiveModel = normalizeModelName(process.env.XAI_MODEL || DEFAULT_MODEL);
  console.log("✅ HTTP+WS listening on", PORT);
  console.log("✅ Using model:", effectiveModel);
});
