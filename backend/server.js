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

/**
 * ✅ ثابتِ پرامپت proactive (همون نسخه‌ی اصلاح‌شده‌ای که گفتی)
 * نکته: اگر کاربر داخل UI یک "Context/Prompt" هم بنویسه، ما به انتهای همین system اضافه می‌کنیم.
 */
const PROACTIVE_SYSTEM_BASE =
  "You are a real-time proactive copilot. You receive partial live transcript every 1.5 seconds. " +
  "Produce ONLY one short helpful suggestion (max 12 words) OR return an empty string if nothing useful. " +
  "Do not repeat earlier suggestions.";

/**
 * Call xAI Chat Completions
 * - model: grok-4.1-fast-non-reasoning  ✅ مطابق کلید تو
 * - temperature: 0.1
 * - max_tokens: 24
 */
async function callXai({ text, userContext }) {
  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) {
    return { ok: false, status: 500, error: "XAI_API_KEY is missing" };
  }

  const model = process.env.XAI_MODEL || "grok-4.1-fast-non-reasoning"; // ✅
  const temperature = 0.1;
  const max_tokens = 24;

  const cleanText = (text ?? "").toString().trim();
  if (!cleanText) {
    return { ok: false, status: 400, error: "Missing text" };
  }

  // اگر کاربر توی UI یک context نوشته باشد، به system اضافه می‌کنیم
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
        // این همون LIVE_TRANSCRIPT_LAST_300_CHARS توست (اینجا از text میاد)
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

/**
 * HTTP endpoint used by frontend (fetch)
 * body: { text: string, system: string }
 * - text  => transcript
 * - system => user context/prompt
 */
app.post("/chat", async (req, res) => {
  try {
    const { text, system } = req.body || {};

    const out = await callXai({ text, userContext: system });

    if (!out.ok) {
      return res
        .status(out.status || 500)
        .json({ error: out.error, details: out.details });
    }

    // ممکنه reply خالی باشه (طبق prompt). این باید OK باشه.
    return res.json({ reply: out.reply });
  } catch (err) {
    console.error("Backend error:", err);
    return res.status(500).json({ error: "Backend failed" });
  }
});

/**
 * WebSocket endpoint (optional / future)
 * expects message JSON: { text: string, system?: string }
 */
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", status: "connected" }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString() || "{}");
      const text = msg?.text;
      const system = msg?.system;

      const out = await callXai({ text, userContext: system });

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
  console.log("✅ HTTP+WS listening on", PORT);
});
