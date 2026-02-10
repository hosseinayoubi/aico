export default function StatusBar({ status, mode }) {
  return (
    <div style={{ opacity: 0.9, fontSize: 13, color: "rgba(229,231,235,0.85)" }}>
      <b>aico.weomeo.win</b> &nbsp;|&nbsp; Auto-stop: 2 minutes silence &nbsp;|&nbsp; Mode: <b>{mode}</b>
    </div>
  );
}
