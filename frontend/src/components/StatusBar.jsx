export default function StatusBar({ status, wsStatus, mode }) {
  return (
    <div className="status" style={{ marginBottom: 10, opacity: 0.9 }}>
      Status: {status} | WS: {wsStatus} | Mode: {mode}
    </div>
  );
}
