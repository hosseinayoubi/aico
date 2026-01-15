import { useEffect, useRef, useState } from "react";
import StatusBar from "./components/StatusBar.jsx";
import SuggestionPanel from "./components/SuggestionPanel.jsx";
import ChatBox from "./components/ChatBox.jsx";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [reply, setReply] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a proactive AI copilot."
  );

  const recognitionRef = useRef(null);

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

    rec.onresult = async (e) => {
      const spoken = e.results[e.results.length - 1][0].transcript;

      setStatus("thinking");

      try {
        const r = await fetch(import.meta.env.VITE_BACKEND_URL + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: spoken,
            system: systemPrompt,
          }),
        });

        const data = await r.json();
        setReply(data.reply || "");
        setStatus("replying");
      } catch {
        setStatus("backend_error");
      }
    };

    recognitionRef.current = rec;
  }, [systemPrompt]);

  return (
    <div className="app" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <StatusBar status={status} />

      <ChatBox systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />

      <SuggestionPanel text={reply || "Listening..."} />

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
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
    </div>
  );
}
