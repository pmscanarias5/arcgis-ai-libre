const BASE_URL = import.meta.env.VITE_LLM_BASE_URL || "http://localhost:11434/v1";
const MODEL = import.meta.env.VITE_LLM_MODEL || "llama3.1";
const API_KEY = import.meta.env.VITE_LLM_API_KEY || "";

const SYSTEM_PROMPT = `Eres el orquestador de un asistente de mapas GIS. Tu única salida debe ser un
objeto JSON, sin texto adicional, sin markdown, sin explicaciones.

Analiza la petición del usuario y decide qué acción ejecutar sobre el mapa.
Responde EXCLUSIVAMENTE con un JSON de una de estas formas:

{"action":"change_basemap","params":{"basemap":"satelite|topografico|oscuro|calles"}}
{"action":"go_to_location","params":{"longitude":<num>,"latitude":<num>,"zoom":<num>,"label":"<nombre del lugar>"}}
{"action":"query_layer","params":{"layer_hint":"<palabra clave de la capa>","metric_hint":"<palabra clave del campo, o null>","order":"desc|asc","limit":<num>}}
{"action":"create_buffer","params":{"distance_km":<num>}}

{"action":"none","params":{"reply":"<respuesta breve en español si no aplica ninguna acción>"}}

Para "query_layer": úsala cuando el usuario pregunte por datos dentro de una capa
ya cargada en el mapa (el municipio más poblado, cuántos elementos hay, el valor
máximo o mínimo de un campo, etc.). No inventes nombres exactos de capa ni de campo:
- "layer_hint" es la palabra que probablemente aparece en el TÍTULO de la capa
  (ej. "municipios", "provincias", "sismos").
- "metric_hint" es la palabra que probablemente aparece en el NOMBRE o ALIAS del
  campo a analizar (ej. "poblacion", "magnitud"). Usa null si el usuario solo
  pide contar cuántos elementos tiene la capa, sin comparar ningún campo.
- "order" es "desc" para el valor mayor (más poblado, máximo) o "asc" para el
  menor (más pequeño, mínimo). Por defecto "desc".
- "limit" es cuántos resultados devolver; 1 si no se especifica.

Para "go_to_location" calcula tú mismo las coordenadas aproximadas del lugar mencionado.
Si la petición no encaja en ninguna acción, usa "none" y responde de forma breve y útil.`;

/**
 * Envía el prompt del usuario al modelo y devuelve la intención estructurada.
 * Funciona con cualquier endpoint compatible con la API de chat/completions
 * de OpenAI (Ollama, LM Studio, Groq, Together, vLLM, etc.), por lo que
 * puedes apuntar VITE_LLM_BASE_URL a un modelo libre autoalojado o gratuito.
 */
export async function getIntent(userPrompt, history = []) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userPrompt }
  ];

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
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
    return { action: "none", params: { reply: raw || "No he podido interpretar la respuesta del modelo." } };
  }
}
