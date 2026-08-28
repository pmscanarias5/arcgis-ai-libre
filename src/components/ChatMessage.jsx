export default function ChatMessage({ sender, text, time, options, onOptionSelect }) {
  return (
    <div className={`message ${sender}`}>
      <span dangerouslySetInnerHTML={{ __html: text }} />
      {options && options.length > 0 && (
        <div className="message-options">
          {options.map((opt) => (
            <button key={opt.id} className="message-option-btn" onClick={() => onOptionSelect(opt)}>
              {opt.title}
            </button>
          ))}
        </div>
      )}
      <div className="timestamp">{time}</div>
    </div>
  );
}