import { useEffect, useMemo, useRef, useState } from "react";
import StatusBar from "./components/StatusBar.jsx";
import SuggestionPanel from "./components/SuggestionPanel.jsx";
import ChatBox from "./components/ChatBox.jsx";

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [status, setStatus] = useState("idle"); // idle | unsupported | listening | thinking | replying | ws_error | backend_error
  const [wsStatus, setWsStatus] = useState("disconnected"); // disconnected | connecting | connected | reconnecting | ws_error
  const [reply, setReply] = useState("");
  const [liveReply, setLiveReply] = useState(""); // تایپ شونده
  const [systemPrompt, setSystemPrompt] = useState("You are a proactive AI copilot.");
  const [mode, setMode] = useState("proactive"); // proactive | deep

  // متن شنیده‌شده (کلمه به کلمه)
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastRequestIdRef = useRef("");

  // برای اینکه هر “وقفه کوتاه” یک بار ارسال کنیم (نه هر کلمه)
  const sendDebounceRef = useRef(null);
  const bufferRef = useRef("");

  // اگر 2 دقیقه چیزی نشنوه، stop کن
  const silenceTimerRef = useRef(null);
  const SILENCE_MS = 120000;

  // تایپ‌افکت جواب
  const typeTimerRef = useRef(null);

  const WS_URL = useMemo(() => import.meta.env.VITE_WS_URL, []);

  function cleanupReconnectTimer() {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  }

  function resetSilenceTimer() {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      // 2 دقیقه سکوت
      stopListening(true);
    }, SILENCE_MS);
  }

  async function ensureMicPermission() {
    // روی موبایل بهتره یکبار getUserMedia صدا زده بشه تا permission درست ثبت شه
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  function connectWS() {
    if (!WS_URL) {
      setWsStatus("ws_error");
      setStatus("ws_error");
      return;
    }

    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) return;

    setWsStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      cleanupReconnectTimer();
      setWsStatus("connected");
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data || "{}");
        if (msg.type === "status") return;

        if (msg.type === "reply") {
          if (msg.requestId && msg.requestId !== lastRequestIdRef.current) return;

          setReply(msg.reply || "");
          setStatus("replying");
          startTypeReply(msg.reply || "");
          return;
        }

        if (msg.type === "error") {
          console.error("WS error:", msg);
          setStatus("backend_error");
          setReply("Backend error. Check Railway logs.");
          startTypeReply("Backend error. Check Railway logs.");
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
      reconnectTimerRef.current = setTimeout(() => connectWS(), 1200);
    };
  }

  function sendToBackend(text) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
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
        text,
        system: systemPrompt,
        mode,
        requestId,
      })
    );
  }

  function flushSend() {
    const text = (bufferRef.current || "").trim();
    if (!text) return;
    bufferRef.current = "";
    sendToBackend(text);
  }

  function scheduleSendDebounced() {
    if (sendDebounceRef.current) clearTimeout(sendDebounceRef.current);

    // وقتی کاربر یک مکث کوتاه داشت، ارسال کن (برای proactive خیلی خوبه)
    const delay = mode === "proactive" ? 700 : 900;

    sendDebounceRef.current = setTimeout(() => {
      flushSend();
    }, delay);
  }

  function startTypeReply(fullText) {
    // تایپ افکت کلمه‌به‌کلمه
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    const words = String(fullText || "").split(/\s+/).filter(Boolean);
    let i = 0;
    setLiveReply("");

    typeTimerRef.current = setInterval(() => {
      i += 1;
      setLiveReply(words.slice(0, i).join(" "));
      if (i >= words.length) {
        clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
    }, 40);
  }

  async function startListening() {
    connectWS();

    const ok = await ensureMicPermission();
    if (!ok) {
      // کاربر allow نکرده
      setStatus("idle");
      return;
    }

    shouldListenRef.current = true;
    resetSilenceTimer();

    try {
      recognitionRef.current?.start();
      setStatus("listening");
    } catch {
      // اگر start سریع پشت سر هم بخوره
      setStatus("listening");
    }
  }

  function stopListening(auto = false) {
    shouldListenRef.current = false;
    clearSilenceTimer();

    try {
      recognitionRef.current?.stop();
    } catch {}

    setStatus("idle");

    if (auto) {
      // اگر 2 دقیقه سکوت بود، یه پیام دوستانه
      setTranscript((t) => t); // no-op
    }
  }

  // WS init
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

  // SpeechRecognition init
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("unsupported");
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;

    // ✅ کلمه‌به‌کلمه (interim)
    rec.interimResults = true;

    rec.onresult = (e) => {
      resetSilenceTimer();

      let interim = "";
      let finalChunk = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r?.[0]?.transcript || "";
        if (r.isFinal) finalChunk += txt;
        else interim += txt;
      }

      // نمایش تایپی: final + interim
      setTranscript((prev) => {
        const base = prev.replace(/\s+/g, " ").trim();
        const shown = `${base}${base ? " " : ""}${finalChunk}`.replace(/\s+/g, " ").trim();
        const withInterim = `${shown}${shown ? " " : ""}${interim}`.replace(/\s+/g, " ").trim();
        return withInterim;
      });

      // به بافر ارسال اضافه کن (اما هر کلمه ارسال نکن)
      const combined = `${finalChunk} ${interim}`.trim();
      if (combined) {
        bufferRef.current = (bufferRef.current + " " + combined).replace(/\s+/g, " ").trim();
        scheduleSendDebounced();
      }

      // اگر final داشتیم، transcript رو تمیز کنیم (interim حذف می‌شه با update بعدی)
      if (finalChunk) {
        setTranscript((prev) => prev.replace(/\s+/g, " ").trim());
      }
    };

    rec.onerror = () => {
      // خطای گذرا زیاد رخ می‌ده؛ ما listening رو نگه می‌داریم
      setStatus("listening");
    };

    rec.onend = () => {
      // ✅ دائم گوش بده تا وقتی Stop نزدی
      if (shouldListenRef.current) {
        try {
          rec.start();
        } catch {
          setTimeout(() => {
            try {
              rec.start();
            } catch {}
          }, 250);
        }
      }
    };

    recognitionRef.current = rec;

    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, [mode]);

  return (
    <div className="app" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <StatusBar status={status} wsStatus={wsStatus} mode={mode} />

      <div style={{ display: "flex", gap: 10, margin: "10px 0 16px" }}>
        <button onClick={() => setMode("proactive")} style={{ opacity: mode === "proactive" ? 1 : 0.6 }}>
          ⚡ Proactive (longer)
        </button>
        <button onClick={() => setMode("deep")} style={{ opacity: mode === "deep" ? 1 : 0.6 }}>
          🎧 Deep (long)
        </button>
      </div>

      <ChatBox systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #334155", borderRadius: 8 }}>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>Live transcript (word by word)</div>
        <div style={{ minHeight: 44, whiteSpace: "pre-wrap" }}>
          {transcript || "Say something..."}
        </div>
      </div>

      <SuggestionPanel text={liveReply || reply || "Listening..."} />

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={startListening}>Start</button>
        <button onClick={() => stopListening(false)}>Stop</button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
        WS: {WS_URL || "(missing VITE_WS_URL)"} | Auto-stop after: 2 minutes silence
      </div>
    </div>
  );
}
