import { useEffect, useRef, useState } from "react";
import StatusBar from "./components/StatusBar";
import SuggestionPanel from "./components/SuggestionPanel";
import ChatBox from "./components/ChatBox";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [reply, setReply] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a proactive AI copilot."
  );

  const recognitionRef = useRef(null);
  const wsRef = useRef(null);

  // اتصال WebSocket
  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL;

    if (!wsUrl) {
      setStatus("missing_ws_url");
      return;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("ws_connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data || "{}");

        if (data.type === "status") {
          // status هایی مثل connected / thinking
          if (data.status === "thinking") setStatus("thinking");
        }

        if (data.type === "reply") {
          setReply(data.reply || "");
          setStatus("replying");
        }

        if (data.type === "error") {
          setReply(data.error || "Error");
          setStatus("backend_error");
        }
      } catch {
        // اگر پیام JSON نبود
      }
    };

    ws.onerror = () => {
      setStatus("ws_error");
    };

    ws.onclose = () => {
      setStatus("ws_closed");
    };

    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, []);

  // SpeechRecognition
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR) {
      setStatus("unsupported");
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e) => {
      const spoken = e.results[e.results.length - 1][0].transcript;

      // اگر WS آماده نیست
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus("ws_not_ready");
        return;
      }

      setStatus("thinking");

      ws.send(
        JSON.stringify({
          text: spoken,
          system: systemPrompt
        })
      );
    };

    recognitionRef.current = rec;
  }, [systemPrompt]);

  return (
    <div className="app">
      <StatusBar status={status} />

      <ChatBox systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />

      <SuggestionPanel text={reply || "Listening..."} />

      <button
        onClick={() => {
          recognitionRef.current?.start();
          setStatus("listening");
        }}
      >
        Start
      </button>

      <button
        onClick={() => {
          recognitionRef.current?.stop();
          setStatus("idle");
        }}
      >
        Stop
      </button>
    </div>
  );
}
