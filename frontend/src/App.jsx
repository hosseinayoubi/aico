import { useEffect, useMemo, useRef, useState } from "react";
import StatusBar from "./components/StatusBar.jsx";
import SuggestionPanel from "./components/SuggestionPanel.jsx";
import ChatBox from "./components/ChatBox.jsx";

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [status, setStatus] = useState("idle");
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [reply, setReply] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("You are a proactive AI copilot.");
  const [mode, setMode] = useState("proactive");
  const [testText, setTestText] = useState("Hello! Give me one suggestion.");

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
      console.log("❌ Missing VITE_WS_URL");
      setWsStatus("ws_error");
      setStatus("ws_error");
      return;
    }

    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) return;

    console.log("🔌 Connecting WS to:", WS_URL);
    setWsStatus("connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WS open");
      cleanupReconnectTimer();
      setWsStatus("connected");
    };

    ws.onmessage = (evt) => {
      console.log("📥 WS message:", evt.data);

      try {
        const msg = JSON.parse(evt.data || "{}");

        if (msg.type === "status") return;

        if (msg.type === "reply") {
          if (msg.requestId && msg.requestId !== lastRequestIdRef.current) return;
          setReply(msg.reply || "");
          setStatus("replying");
          return;
        }

        if (msg.type === "error") {
          console.error("WS error payload:", msg);
          setStatus("backend_error");
          setReply("Backend error. Check Railway logs.");
          return;
        }
      } catch (e) {
        console.error("Bad WS message:", e);
      }
    };

    ws.onerror = (e) => {
      console.log("❌ WS error", e);
      setWsStatus("ws_error");
      setStatus("ws_error");
    };

    ws.onclose = () => {
      console.log("⚠️ WS closed → reconnecting...");
      setWsStatus("reconnecting");

      cleanupReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => connectWS(), 1200);
    };
  }

  function sendToBackend(text) {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log("⚠️ WS not open, reconnecting...");
      setReply("WebSocket not connected. Reconnecting...");
      setStatus("ws_error");
      connectWS();
      return;
    }

    const requestId = makeId();
    lastRequestIdRef.current = requestId;

    console.log("📤 sending to WS:", { text, mode, requestId });

    setStatus("thinking");
    ws.send(
      JSON.stringify({
        type: "chat",
        text,
        system: systemPrompt,
        mode,
        requestId,
      })
    );
  }

  useEffect(() => {
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
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR) {
      console.log("❌ SpeechRecognition unsupported");
      setStatus("unsupported");
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onstart = () => console.log("🎤 recognition started");
    rec.onend = () => console.log("🎤 recognition ended");

    rec.onresult = (e) => {
      const spoken = e.results[e.results.length - 1][0].transcript;
      console.log("🎤 onresult fired:", spoken);

      if (!spoken || !spoken.trim()) return;
      sendToBackend(spoken);
    };

    rec.onerror = (err) => {
      console.log("🎤 Speech error:", err);
      setStatus("idle");
    };

    recognitionRef.current = rec;
  }, [systemPrompt, mode]);

  return (
    <div className="app" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <StatusBar status={status} wsStatus={wsStatus} mode={mode} />

      <div style={{ display: "flex", gap: 10, margin: "10px 0 16px" }}>
        <button onClick={() => setMode("proactive")} style={{ opacity: mode === "proactive" ? 1 : 0.6 }}>
          ⚡ Proactive (short)
        </button>
        <button onClick={() => setMode("deep")} style={{ opacity: mode === "deep" ? 1 : 0.6 }}>
          🎧 Deep (long)
        </button>
      </div>

      <ChatBox systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />

      <div style={{ margin: "12px 0", padding: 12, border: "1px solid #334155", borderRadius: 8 }}>
        <div style={{ opacity: 0.8, marginBottom: 8 }}>Manual test (no mic)</div>
        <input
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          style={{
            width: "100%",
            padding: 10,
            background: "#0b1220",
            color: "#e5e7eb",
            border: "1px solid #334155",
            borderRadius: 8,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button onClick={() => sendToBackend(testText)}>Send</button>
          <button
            onClick={() => {
              console.log("🔄 reconnect clicked");
              try { wsRef.current?.close(); } catch {}
              connectWS();
            }}
          >
            Reconnect WS
          </button>
        </div>
      </div>

      <SuggestionPanel text={reply || "Listening..."} />

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          onClick={() => {
            console.log("▶️ Start clicked");
            connectWS();
            recognitionRef.current?.start();
            setStatus("listening");
          }}
        >
          Start
        </button>

        <button
          onClick={() => {
            console.log("⏹ Stop clicked");
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
