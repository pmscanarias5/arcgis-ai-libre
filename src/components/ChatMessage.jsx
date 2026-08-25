export default function ChatMessage({ sender, text, time }) {
  return (
    <div className={`message ${sender}`}>
      <span dangerouslySetInnerHTML={{ __html: text }} />
      <div className="timestamp">{time}</div>
    </div>
  );
}
