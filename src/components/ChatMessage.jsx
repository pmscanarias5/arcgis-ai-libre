export default function ChatMessage({ sender, text, time, options, onOptionSelect, onOpenTable }) {
  // El texto llega como HTML, así que los enlaces "tabla de atributos" no son
  // elementos React: se captura el clic por delegación en el contenedor.
  function handleTextClick(e) {
    const link = e.target.closest("[data-open-table-layer-id]");
    if (!link || !onOpenTable) return;
    e.preventDefault();
    onOpenTable(link.dataset.openTableLayerId);
  }

  return (
    <div className={`message ${sender}`}>
      <span onClick={handleTextClick} dangerouslySetInnerHTML={{ __html: text }} />
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