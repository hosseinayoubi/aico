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
  const [systemPrompt, setSystemPrompt] = useState("You are a proactive AI copilot.");
  const [mode, setMode] = useState("proactive");

  const [showLive, setShowLive] = useState(true);
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");

  const [reply, setReply] = useState("");
  const [liveReply, setLiveReply] = useState("");

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);

  const wsRef = useRef(null);
  const lastRequestIdRef = useRef("");

  const bufferFinalRef = useRef("");

  // 🔑 adaptive timers
  const shortSilenceTimerRef = useRef(null); // ~700ms
  const longFallbackTimerRef = useRef(null); // 5s
  const lastSendTsRef = useRef(0);

  const silenceStopTimerRef = useRef(null);
  const SILENCE_STOP_MS = 120000;

  const typeTimerRef = useRef(null);

  const WS_URL = useMemo(() => import.meta.env.VITE_WS_URL, []);

  /* ---------------- WebSocket ---------------- */

  function connectWS() {
    if (!WS_URL) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) return;

    setWsStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus("connected");

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data || "{}");
      if (msg.type !== "reply") return;
      if (msg.requestId !== lastRequestIdRef.current) return;

      setReply(msg.reply || "");
      setStatus("replying");
      startTypeReply(msg.reply || "");
    };

    ws.onclose = () => {
      setWsStatus("reconnecting");
      setTimeout(connectWS, 1200);
    };
  }

  /* ---------------- Reply typing ---------------- */

  function startTypeReply(text) {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    const words = text.split(/\s+/);
    let i = 0;
    setLiveReply("");

    typeTimerRef.current = setInterval(() => {
      i++;
      setLiveReply(words.slice(0, i).join(" "));
      if (i >= words.length) clearInterval(typeTimerRef.current);
    }, 25);
  }

  /* ---------------- Sending ---------------- */

  function sendNow(text) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    lastSendTsRef.current = Date.now();
    const requestId = makeId();
    lastRequestIdRef.current = requestId;

    setStatus("thinking");

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        text,
        system: systemPrompt,
        mode,
        requestId,
      })
    );
  }

  function clearAdaptiveTimers() {
    if (shortSilenceTimerRef.current) clearTimeout(shortSilenceTimerRef.current);
    if (longFallbackTimerRef.current) clearTimeout(longFallbackTimerRef.current);
  }

  function scheduleAdaptiveSend() {
    clearAdaptiveTimers();

    const now = Date.now();
    const gap = now - lastSendTsRef.current;

    // 🔥 کوتاه: اگر کاربر مکث کرد → سریع جواب بده
    shortSilenceTimerRef.current = setTimeout(() => {
      const text = bufferFinalRef.current.trim();
      if (!text) return;

      bufferFinalRef.current = "";
      sendNow(text);
    }, 700);

    // 🧱 fallback: اگر silence نیامد → 5s
    if (gap < 5000) {
      longFallbackTimerRef.current = setTimeout(() => {
        const text = bufferFinalRef.current.trim();
        if (!text) return;

        bufferFinalRef.current = "";
        sendNow(text);
      }, 5000 - gap);
    }
  }

  /* ---------------- Listening ---------------- */

  function resetSilenceStop() {
    if (silenceStopTimerRef.current) clearTimeout(silenceStopTimerRef.current);
    silenceStopTimerRef.current = setTimeout(stopListening, SILENCE_STOP_MS);
  }

  function startListening() {
    connectWS();
    shouldListenRef.current = true;
    resetSilenceStop();

    setFinalText("");
    setInterimText("");
    bufferFinalRef.current = "";
    lastSendTsRef.current = 0;

    try {
      recognitionRef.current.start();
    } catch {}
    setStatus("listening");
  }

  function stopListening() {
    shouldListenRef.current = false;
    clearAdaptiveTimers();
    try {
      recognitionRef.current.stop();
    } catch {}
    setStatus("idle");
  }

  /* ---------------- SpeechRecognition (ONE TIME) ---------------- */

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("unsupported");
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      resetSilenceStop();

      let newFinal = "";
      let newInterim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) newFinal += r[0].transcript;
        else newInterim += r[0].transcript;
      }

      if (showLive) setInterimText(newInterim.trim());

      if (newFinal.trim()) {
        setFinalText((p) => (p + " " + newFinal).trim());
        bufferFinalRef.current += " " + newFinal;
        scheduleAdaptiveSend();
      }
    };

    rec.onend = () => {
      if (shouldListenRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };

    recognitionRef.current = rec;
    return () => rec.stop();
  }, [showLive, mode]);

  useEffect(connectWS, []);

  const transcriptToShow = showLive
    ? `${finalText} ${interimText}`.trim()
    : finalText;

  return (
    <div className="appShell">
      <StatusBar status={status} wsStatus={wsStatus} mode={mode} />

      <div className="controlsRow">
        <button onClick={() => setMode("proactive")}>⚡ Proactive (adaptive)</button>
        <button onClick={() => setMode("deep")}>🎧 Deep</button>

        <label>
          <input
            type="checkbox"
            checked={showLive}
            onChange={(e) => setShowLive(e.target.checked)}
          />
          Live transcript
        </label>
      </div>

      {showLive && <div className="card">{transcriptToShow || "Listening..."}</div>}

      <SuggestionPanel text={liveReply || reply || "Listening..."} />

      <div className="bottomBar">
        <button onClick={startListening}>Start</button>
        <button onClick={stopListening}>Stop</button>
      </div>
    </div>
  );
}
