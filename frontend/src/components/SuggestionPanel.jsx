export default function SuggestionPanel({ text }) {
  return <div className="panel">{text || "Listening..."}</div>;
}