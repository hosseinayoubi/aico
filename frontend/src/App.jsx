import { useEffect, useMemo, useRef, useState } from "react";
import StatusBar from "./components/StatusBar.jsx";
import SuggestionPanel from "./components/SuggestionPanel.jsx";
import ChatBox from "./components/ChatBox.jsx";

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [status, setStatus] = useState("idle"); // idle | unsupported | listening | thinking | replying | ws_error
  const [wsStatus, setWsStatus] = useState("disconnected"); // disconnected | connecting | connected | reconnecting
  const [reply, setReply] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("You are a proactive AI copilot.");
  const [mode, setMode] = useState("deep"); // deep | proactive

  const recognitionRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastRequestIdRef = useRef("");

  const WS_URL = useMemo(() => import.meta.env.VITE_WS_URL, []);

  function cleanupReconnectTimer() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function connectWS() {
    if (!WS_URL) {
      setWsStatus("ws_error");
      setStatus("ws_error");
      return;
    }

    // if already open/connecting, skip
    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setWsStatus((prev) => (prev === "connected" ? "connected" : "connecting"));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      cleanupReconnectTimer();
      setWsStatus("connected");
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data || "{}");

        if (msg.type === "status") {
          // optional: show model somewhere later
          return;
        }

        if (msg.type === "reply") {
          // ignore old replies if requestId doesn't match last request
          if (msg.requestId && msg.requestId !== lastRequestIdRef.current) return;

          setReply(msg.reply || "");
          setStatus("replying");
          return;
        }

        if (msg.type === "error") {
          console.error("WS error:", msg);
          setStatus("backend_error");
          setReply("Backend error. Check Railway logs.");
          return;
        }
      } catch (e) {
        console.error("Bad WS message:", e);
      }
    };

    ws.onerror = () => {
      setWsStatus("ws_error");
      setStatus("ws_error");
    };

    ws.onclose = () => {
      setWsStatus("reconnecting");

      cleanupReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        connectWS();
      }, 1200);
    };
  }

  function sendToBackend(spokenText) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setReply("WebSocket not connected. Reconnecting...");
      setStatus("ws_error");
      connectWS();
      return;
    }

    const requestId = makeId();
    lastRequestIdRef.current = requestId;

    setStatus("thinking");

    ws.send(
      JSON.stringify({
        type: "chat",
        text: spokenText,
        system: systemPrompt,
        mode, // deep or proactive
        requestId,
      })
    );
  }

  useEffect(() => {
    // init WS
    connectWS();

    return () => {
      cleanupReconnectTimer();
      try {
        wsRef.current?.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // init SpeechRecognition
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
      if (!spoken || !spoken.trim()) return;

      // send via WS
      sendToBackend(spoken);
    };

    rec.onerror = () => setStatus("idle");
    rec.onend = () => {
      // اگر کاربر Stop نزده باشه، بعضی مرورگرها خودکار end می‌زنن
      // ما status رو همون listening نگه نمی‌داریم که گیج نشه
      // کاربر با Start دوباره فعالش می‌کنه
    };

    recognitionRef.current = rec;
  }, [systemPrompt, mode]);

  return (
    <div className="app" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <StatusBar status={status} wsStatus={wsStatus} mode={mode} />

      <div style={{ display: "flex", gap: 10, margin: "10px 0 16px" }}>
        <button
          onClick={() => {
            setMode("proactive");
            setReply("");
          }}
          style={{
            opacity: mode === "proactive" ? 1 : 0.6,
          }}
        >
          ⚡ Proactive (short)
        </button>

        <button
          onClick={() => {
            setMode("deep");
            setReply("");
          }}
          style={{
            opacity: mode === "deep" ? 1 : 0.6,
          }}
        >
          🎧 Deep (long)
        </button>
      </div>

      <ChatBox systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />

      <SuggestionPanel text={reply || (mode === "deep" ? "Listening deeply..." : "Listening...")} />

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          onClick={() => {
            connectWS();
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

      <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
        WS: {WS_URL || "(missing VITE_WS_URL)"}
      </div>
    </div>
  );
}
