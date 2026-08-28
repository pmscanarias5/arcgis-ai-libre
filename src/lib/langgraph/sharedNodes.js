import { callStructuredLLM } from "../llm/callStructuredLLM.js";

export function normalize(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function findLabelField(fields, displayFieldName) {
  if (displayFieldName) {
    const f = fields.find((f) => f.name === displayFieldName);
    if (f) return f;
  }
  const candidates = ["nombre", "name", "municipio", "denominacion", "etiqueta", "rotulo", "toponimo"];
  return (
    fields.find((f) => candidates.some((c) => normalize(f.name).includes(c) || normalize(f.alias).includes(c))) ||
    fields.find((f) => f.type === "string") ||
    null
  );
}

const SELECT_LAYER_PROMPT = `Eres un asistente que identifica a qué capa geográfica se refiere una
petición del usuario, eligiendo EXCLUSIVAMENTE entre una lista de capas que están
realmente cargadas en el mapa. No inventes capas que no estén en la lista y si tienes dudas devuelve null. Realiza un intento de identificación en base a la entidad del usuario, intentando cruzar la petición con el tipo de entidad que puede contener cada capa.
Por ejemplo, si la petición del usuario es "buffer sobre Pinilla del Valle" y la lista de capas cargadas es ["municipios", "ríos", "carreteras"], la capa más adecuada es "municipios" (porque Pinilla del Valle es un municipio), y no "ríos" ni "carreteras".
Ten en cuenta en el prompt de usuario la entidad que se indica para hacer una valoración de que tipo de capa puede ser la más adecuada.
La capa de ríos tiene las siguientes entidades: Ebro, Duero, Tajo, Guadalquivir, Júcar, Segura, Miño y Guadiana.

Responde solo con JSON, sin texto adicional:
{"layer_id":"<id exacto de la lista>"} si encuentras una coincidencia razonable
{"layer_id":null} si ninguna capa de la lista encaja con la petición`;

/**
 * Decide qué capa usar. Ya NO es un nodo de LangGraph ni usa interrupt():
 * es una función normal, llamada directamente por runQueryLayerGraph y
 * runBufferEntityGraph ANTES de construir/ejecutar su StateGraph. Así
 * evitamos depender de mecanismos de Node (AsyncLocalStorage) que no
 * tienen un equivalente fiable en el navegador.
 *
 * Devuelve { selectedLayerId } si el LLM decide con confianza, o
 * { needsSelection: true, options } si hace falta preguntar al usuario.
 */
export async function resolveLayer(userPrompt, availableLayers) {
  const layersDescription = availableLayers.map((l) => `- id: "${l.id}", título: "${l.title}"`).join("\n");
  const userContent = `Capas cargadas en el mapa:\n${layersDescription}\n\nPetición del usuario: "${userPrompt}"`;

  const result = await callStructuredLLM(SELECT_LAYER_PROMPT, [{ role: "user", content: userContent }]);
  const selectedLayerId = result?.layer_id ?? null;

  const isValid = availableLayers.some((l) => l.id === selectedLayerId);
  if (!isValid) {
    return { needsSelection: true, options: availableLayers };
  }
  return { selectedLayerId };
}

// Nodo de LangGraph (este sí, sin interrupt): carga el esquema real de
// campos de la capa ya elegida. Requiere en el estado: view, selectedLayerId.
export async function loadSchemaNode(state) {
  const layer = state.view.map.layers.find((l) => l.id === state.selectedLayerId);
  if (!layer) {
    return { resultText: "La capa seleccionada ya no está disponible en el mapa." };
  }

  await layer.load();

  if (typeof layer.queryFeatures !== "function") {
    return { resultText: `La capa <b>${layer.title}</b> no admite consultas de atributos.` };
  }

  const fields = (layer.fields || []).map((f) => ({ name: f.name, alias: f.alias, type: f.type }));
  return { layer, fields };
}