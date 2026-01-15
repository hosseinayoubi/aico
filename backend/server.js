import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { WebSocketServer } from "ws";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const XAI_API_KEY = process.env.XAI_API_KEY;

// برای Railway / Debug
app.use(cors());
app.use(express.json());

// Health check برای اینکه مطمئن شی سرویس بالا هست
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

if (!XAI_API_KEY) {
  console.warn("⚠️ XAI_API_KEY is missing. Set it in Railway Variables.");
}

// HTTP server (تا WS و HTTP هر دو روی یک پورت باشند)
const server = http.createServer(app);

// WebSocket server روی همان PORT
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", status: "connected" }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString() || "{}");
      const text = (msg.text || "").trim();
      const system =
        (msg.system || "").trim() || "You are a proactive AI copilot.";

      if (!text) {
        ws.send(JSON.stringify({ type: "error", error: "Missing text" }));
        return;
      }

      ws.send(JSON.stringify({ type: "status", status: "thinking" }));

      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${XAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "grok-beta",
          messages: [
            { role: "system", content: system },
            { role: "user", content: text }
          ]
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("❌ xAI HTTP error:", response.status, data);
        ws.send(
          JSON.stringify({
            type: "error",
            error: `xAI request failed (${response.status})`
          })
        );
        return;
      }

      const reply = data?.choices?.[0]?.message?.content || "";
      ws.send(JSON.stringify({ type: "reply", reply }));
    } catch (err) {
      console.error("❌ WS backend error:", err);
      ws.send(JSON.stringify({ type: "error", error: "Backend failed" }));
    }
  });
});

server.listen(PORT, () => {
  console.log("✅ HTTP+WS listening on", PORT);
});
