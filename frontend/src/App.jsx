import { useEffect, useRef, useState } from 'react';
import StatusBar from './components/StatusBar';
import SuggestionPanel from './components/SuggestionPanel';

export default function App() {
  const [status, setStatus] = useState("idle");
  const [text, setText] = useState("");
  const wsRef = useRef(null);

  useEffect(() => {
    
 const WS_URL = import.meta.env.VITE_WS_URL;
if (!WS_URL) {
  setStatus("error");
  return;
}

    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      setStatus("connected");
    };

    wsRef.current.onmessage = (e) => {
      setStatus("suggesting");
      setText((t) => t + e.data);
    };

    wsRef.current.onerror = () => {
      setStatus("error");
    };

    wsRef.current.onclose = () => {
      setStatus("disconnected");
    };

    return () => {
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, []);

  return (
    <div className="app">
      <StatusBar status={status} />
      <SuggestionPanel text={text} />
      <button onClick={() => setStatus("listening")}>Start</button>
    </div>
  );
}
