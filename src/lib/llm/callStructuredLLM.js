const BASE_URL = import.meta.env.VITE_LLM_BASE_URL || "http://localhost:11434/v1";
const MODEL = import.meta.env.VITE_LLM_MODEL || "llama3.1";
const API_KEY = import.meta.env.VITE_LLM_API_KEY || "";

/**
 * Llamada de bajo nivel a un LLM compatible con la API chat/completions de
 * OpenAI, forzando una respuesta JSON. Opcionalmente valida el resultado con
 * un esquema Zod. La reutilizan tanto el router de intenciones como los nodos
 * del grafo de LangGraph.
 *
 * @param {string} systemPrompt - Prompt del sistema
 * @param {Array} messages - Mensajes de la conversación
 * @param {object|null} schema - Esquema Zod opcional para validación
 * @param {number} repairAttemptsLeft - Reintentos de reparación restantes ante fallo de Zod
 * @returns {object|null} Resultado parseado o null en error
 */
export async function callStructuredLLM(systemPrompt, messages, schema = null, repairAttemptsLeft = 1) {
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

  let result;
  try {
    result = JSON.parse(cleaned);
  } catch (err) {
    console.error("Respuesta del modelo no es JSON válido:", raw);
    return null;
  }

  // Validar con Zod si se proporcionó un esquema
  if (schema) {
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      console.warn("Validación Zod falló, intentando reparación:", parsed.error.format?._errors || parsed.error.message);

      if (repairAttemptsLeft <= 0) {
        console.error("Reparación agotada tras reintentos. Datos recibidos:", result);
        return null;
      }

      // Intentar reparar con un segundo llamado al LLM
      const repairPrompt = systemPrompt +
        "\n\nIMPORTANTE: Tu respuesta anterior no tenía el formato correcto. Responde EXACTAMENTE en este formato, sin texto adicional:\n" +
        (schema._def.description || "JSON con las propiedades esperadas.");
      const repaired = await callStructuredLLM(repairPrompt, messages, schema, repairAttemptsLeft - 1);
      if (repaired) return repaired;
      console.error("Reparación falló. Datos recibidos:", result);
      return null;
    }
    return parsed.data;
  }

  return result;
}
