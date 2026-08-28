import { useRef, useState } from "react";
import ChatMessage from "./ChatMessage.jsx";
import { getIntent } from "../lib/llmClient.js";
import { mapActions } from "../lib/mapActions/index.js";

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ChatSidebar({ view }) {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      sender: "bot",
      text: "¡Hola! Soy tu asistente de mapa. Puedo cambiar el mapa base, ir a una ubicación, consultar capas, crear áreas de influencia o imprimir el mapa.",
      time: now()
    }
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const historyRef = useRef([]);
  const msgIdRef = useRef(1);

  function addMessage(sender, text) {
    const id = `m${msgIdRef.current++}`;
    setMessages((prev) => [...prev, { id, sender, text, time: now() }]);
    return id;
  }

  function clearOptions(messageId) {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, options: undefined, resumeFn: undefined } : m))
    );
  }

  // Procesa el resultado de una mapAction, que puede ser:
  // - un string: respuesta final, se muestra tal cual.
  // - { needsInput, question, options, resume }: el grafo se ha pausado y
  //   necesita que el usuario elija una opción (botones) antes de seguir.
  async function handleAgentResult(result) {
    if (result && typeof result === "object" && result.needsInput) {
      const messageId = addMessage("bot", result.question);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                options: result.options,
                resumeFn: async (choice) => {
                  clearOptions(messageId);
                  addMessage("user", choice.title);
                  setThinking(true);
                  try {
                    const next = await result.resume(choice.id);
                    await handleAgentResult(next);
                  } catch (err) {
                    console.error("Error al continuar la petición:", err);
                    addMessage("bot", "Lo siento, ocurrió un error al continuar con tu elección.");
                  } finally {
                    setThinking(false);
                  }
                }
              }
            : m
        )
      );
      return;
    }

    addMessage("bot", result);
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
      historyRef.current = historyRef.current.slice(-10);

      const action = mapActions[intent.action] || mapActions.none;
      const result = await action(view, { ...(intent.params || {}), _userPrompt: prompt });
      await handleAgentResult(result);
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
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            sender={m.sender}
            text={m.text}
            time={m.time}
            options={m.options}
            onOptionSelect={m.resumeFn}
          />
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