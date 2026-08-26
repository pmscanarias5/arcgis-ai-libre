const BASE_URL = import.meta.env.VITE_LLM_BASE_URL || "http://localhost:11434/v1";
const MODEL = import.meta.env.VITE_LLM_MODEL || "llama3.1";
const API_KEY = import.meta.env.VITE_LLM_API_KEY || "";

/**
 * Llamada de bajo nivel a un LLM compatible con la API chat/completions de
 * OpenAI, forzando una respuesta JSON. La reutilizan tanto el router de
 * intenciones (llmClient.js) como los nodos del grafo de LangGraph.
 */
export async function callStructuredLLM(systemPrompt, messages) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Error del modelo (${response.status}): ${text}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Respuesta del modelo no es JSON válido:", raw);
    return null;
  }
}