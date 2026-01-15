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
  const [systemPrompt, setSystemPrompt] = useState("You are a proactive AI copilot.");
  const [mode, setMode] = useState("proactive"); // proactive | deep

  // ✅ Toggle برای Live Transcript
  const [showLive, setShowLive] = useState(true);

  // فقط برای نمایش
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");

  // فقط آخرین جواب (بدون history)
  const [reply, setReply] = useState("");
  const [liveReply, setLiveReply] = useState("");

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastRequestIdRef = useRef("");

  // ✅ فقط final ها برای ارسال
  const bufferFinalRef = useRef("");

  // ✅ Proactive throttle: هر 5 ثانیه
  const lastSendTsRef = useRef(0);

  // auto-stop silence
  const silenceTimerRef = useRef(null);
  const SILENCE_MS = 120000; // 2 minutes

  // type effect
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
      stopListening(true);
    }, SILENCE_MS);
  }

  async function ensureMicPermission() {
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

  function startTypeReply(fullText) {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);

    const words = String(fullText || "").split(/\s+/).filter(Boolean);
    let i = 0;
    setLiveReply("");

    if (!words.length) return;

    typeTimerRef.current = setInterval(() => {
      i += 1;
      setLiveReply(words.slice(0, i).join(" "));
      if (i >= words.length) {
        clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
    }, 30);
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

  function flushIfAllowed() {
    const text = (bufferFinalRef.current || "").trim();
    if (!text) return;

    const now = Date.now();

    // ✅ اینجاست که ۵ ثانیه‌ای می‌کنیم
    const minGapMs = mode === "proactive" ? 5000 : 900;
    if (now - lastSendTsRef.current < minGapMs) {
      return; // هنوز زوده، صبر می‌کنیم
    }

    lastSendTsRef.current = now;

    // ✅ بعد از ارسال پاک می‌کنیم تا دوباره همونو نفرستیم
    bufferFinalRef.current = "";
    sendToBackend(text);
  }

  async function startListening() {
    connectWS();

    const ok = await ensureMicPermission();
    if (!ok) {
      setStatus("idle");
      return;
    }

    shouldListenRef.current = true;
    resetSilenceTimer();

    // پاکسازی UI هر بار Start
    setInterimText("");
    setFinalText("");
    bufferFinalRef.current = "";
    lastSendTsRef.current = 0;

    try {
      recognitionRef.current?.start();
    } catch {}
    setStatus("listening");
  }

  function stopListening(auto = false) {
    shouldListenRef.current = false;
    clearSilenceTimer();

    bufferFinalRef.current = "";
    setInterimText("");

    try {
      recognitionRef.current?.stop();
    } catch {}

    setStatus("idle");

    if (auto) {
      // auto stop after silence - no-op
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

  // SpeechRecognition init/re-init (وقتی showLive یا mode عوض میشه)
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("unsupported");
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;

    // ✅ اگر Live روشن: کلمه‌به‌کلمه (interim)
    // ✅ اگر Live خاموش: فقط final (تمیزتر + منطقی‌تر)
    rec.interimResults = !!showLive;

    rec.onresult = (e) => {
      resetSilenceTimer();

      let newFinal = "";
      let newInterim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r?.[0]?.transcript || "";
        if (r.isFinal) newFinal += txt;
        else newInterim += txt;
      }

      if (showLive) setInterimText(newInterim.trim());
      if (!showLive) setInterimText("");

      if (newFinal.trim()) {
        // نمایش final
        setFinalText((prev) => (prev + " " + newFinal).replace(/\s+/g, " ").trim());

        // ✅ فقط final جمع می‌شود (بدون تکرار)
        bufferFinalRef.current = (bufferFinalRef.current + " " + newFinal)
          .replace(/\s+/g, " ")
          .trim();

        // ✅ هر بار که final جدید آمد، تلاش کن اگر فاصله زمانی اجازه می‌دهد ارسال کن
        flushIfAllowed();
      }
    };

    rec.onerror = () => {
      if (shouldListenRef.current) setStatus("listening");
    };

    rec.onend = () => {
      // ✅ یک بار Start تا Stop
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
  }, [showLive, mode]);

  const transcriptToShow = showLive
    ? `${finalText}${finalText && interimText ? " " : ""}${interimText}`.trim()
    : finalText;

  return (
    <div className="appShell">
      <div className="appTop">
        <div className="brand">
          <div className="logoDot" />
          <div>
            <div className="brandTitle">aico</div>
            <div className="brandSub">Realtime voice copilot</div>
          </div>
        </div>

        <div className="controlsRow">
          <button
            className={mode === "proactive" ? "chip active" : "chip"}
            onClick={() => setMode("proactive")}
          >
            ⚡ Proactive (5s)
          </button>
          <button className={mode === "deep" ? "chip active" : "chip"} onClick={() => setMode("deep")}>
            🎧 Deep
          </button>

          <label className="toggle">
            <input
              type="checkbox"
              checked={showLive}
              onChange={(e) => setShowLive(e.target.checked)}
            />
            <span className="toggleUi" />
            <span className="toggleText">Live transcript</span>
          </label>
        </div>
      </div>

      <div className="card">
        <StatusBar status={status} wsStatus={wsStatus} mode={mode} />
      </div>

      <div className="card">
        <ChatBox systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />
      </div>

      {showLive && (
        <div className="card">
          <div className="cardTitle">Live transcript</div>
          <div className="transcriptBox">{transcriptToShow || "Say something..."}</div>
          <div className="hint">
            Proactive sends at most once every 5 seconds.
          </div>
        </div>
      )}

      <div className="card">
        <div className="cardTitle">Copilot</div>
        <SuggestionPanel text={liveReply || reply || "Listening..."} />
      </div>

      <div className="bottomBar">
        <button className="btn primary" onClick={startListening}>
          Start
        </button>
        <button className="btn" onClick={() => stopListening(false)}>
          Stop
        </button>

        <div className="meta">
          <div>WS: {WS_URL || "(missing VITE_WS_URL)"}</div>
          <div>Auto-stop: 2 minutes silence</div>
        </div>
      </div>
    </div>
  );
}
