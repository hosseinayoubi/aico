import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 8080;
const GROK_WS_URL = "wss://api.x.ai/v1/realtime"; // placeholder

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (client) => {
  const grok = new WebSocket(GROK_WS_URL, {
    headers: {
      "Authorization": `Bearer ${process.env.GROK_API_KEY}`
    }
  });

  client.on("message", (data) => {
    if (grok.readyState === WebSocket.OPEN) {
      grok.send(data);
    }
  });

  grok.on("message", (msg) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });

  client.on("close", () => grok.close());
});

console.log("Backend WebSocket running on port", PORT);