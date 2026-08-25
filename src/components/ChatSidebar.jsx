import { useRef, useState } from "react";
import ChatMessage from "./ChatMessage.jsx";
import { getIntent } from "../lib/llmClient.js";
import { mapActions } from "../lib/mapActions/index.js";
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ChatSidebar({ view }) {
  const [messages, setMessages] = useState([
    {
      sender: "bot",
      text: "¡Hola! Soy tu asistente de mapa. Puedo cambiar el mapa base, ir a una ubicación o crear un área de influencia. Escribe tu petición en lenguaje natural.",
      time: now()
    }
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const historyRef = useRef([]); // historial para dar contexto al modelo

  function addMessage(sender, text) {
    setMessages((prev) => [...prev, { sender, text, time: now() }]);
  }

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || thinking) return;

    addMessage("user", prompt);
    setInput("");
    setThinking(true);

    try {
      if (!view) {
        addMessage("bot", "El mapa todavía se está cargando, inténtalo en un momento.");
        return;
      }

      const intent = await getIntent(prompt, historyRef.current);
      historyRef.current.push({ role: "user", content: prompt });
      historyRef.current.push({ role: "assistant", content: JSON.stringify(intent) });
      // Mantén el historial acotado para no disparar el tamaño del contexto
      historyRef.current = historyRef.current.slice(-10);

      const action = mapActions[intent.action] || mapActions.none;
      const reply = await action(view, intent.params || {});
      addMessage("bot", reply);
    } catch (err) {
      console.error("Error al procesar la petición:", err);
      addMessage("bot", "Lo siento, ocurrió un error al conectar con el modelo de IA.");
    } finally {
      setThinking(false);
    }
  }

  function handleKeyPress(e) {
    if (e.key === "Enter") handleSend();
  }

  return (
    <div className="chat-sidebar">
      <div className="chat-header">
        <div className={`status-indicator ${thinking ? "thinking" : ""}`}></div>
        <h2>Asistente GIS (modelo libre)</h2>
      </div>

      <div className="chat-messages">
        {messages.map((m, i) => (
          <ChatMessage key={i} sender={m.sender} text={m.text} time={m.time} />
        ))}
        {thinking && <ChatMessage sender="bot" text="Procesando petición…" time={now()} />}
      </div>

      <div className="chat-input-container">
        <input
          id="userInput"
          type="text"
          placeholder="Escribe tu petición (ej: 'Cambia a mapa satélite')..."
          autoComplete="off"
          value={input}
          disabled={thinking}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <button id="sendBtn" onClick={handleSend} disabled={thinking}>
          Enviar
        </button>
      </div>
    </div>
  );
}
