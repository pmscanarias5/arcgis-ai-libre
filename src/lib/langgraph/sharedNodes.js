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

// Busca entre los campos de la capa el que mejor coincide con una palabra
// clave (p.ej. "poblacion" -> campo "POB_TOTAL", o "provincia" -> campo
// "PROVINCIA"). Se usa para el campo métrica y el campo de filtro en
// query_layer, y para el campo de nombre en buffer_entity.
export function findBestField(fields, hint) {
  const target = normalize(hint);
  if (!target) return null;
  return fields.find((f) => normalize(f.name).includes(target) || normalize(f.alias).includes(target)) || null;
}

// Consulta valores reales y distintos de un campo de texto que contengan
// searchText (sin acentos, sin distinguir mayúsculas). Nunca confiamos en
// un valor "adivinado" por el LLM tal cual: se contrasta siempre contra lo
// que existe de verdad en la capa. La usan tanto buffer_entity (para
// localizar la entidad) como query_layer (para resolver un filtro).
export async function searchDistinctValues(layer, field, searchText, { limit = 10 } = {}) {
  const safe = (searchText || "").replace(/'/g, "''");
  const query = layer.createQuery();
  query.where = `UPPER(${field.name}) LIKE UPPER('%${safe}%')`;
  query.outFields = [field.name];
  query.returnGeometry = false;
  query.num = limit;

  const result = await layer.queryFeatures(query);
  return [...new Set(result.features.map((f) => f.attributes[field.name]).filter((v) => v != null))];
}

const RESOLVE_CANDIDATE_PROMPT = `Eres un asistente que, dada la petición original del usuario y una
lista de coincidencias reales encontradas en los datos, elige cuál de esas
coincidencias es la que el usuario quería decir.

Responde solo con JSON, sin texto adicional:
{"match":"<uno de los valores de la lista, copiado EXACTAMENTE tal cual>"}`;

// Si hay un único candidato real, se usa directo (sin gastar LLM). Si hay
// varios, se le pide al LLM que elija entre ellos -sin inventar ninguno
// nuevo-, usando la petición original como contexto de desambiguación.
export async function resolveAmbiguousValue(userPrompt, candidates) {
  if (candidates.length === 1) return candidates[0];

  const disambiguation = await callStructuredLLM(RESOLVE_CANDIDATE_PROMPT, [
    {
      role: "user",
      content: `Petición original: "${userPrompt}"\nCoincidencias encontradas: ${candidates
        .map((c) => `"${c}"`)
        .join(", ")}`
    }
  ]);

  return candidates.includes(disambiguation?.match) ? disambiguation.match : candidates[0];
}

const SELECT_LAYER_PROMPT = `Eres un asistente que identifica a qué capa geográfica se refiere una
petición del usuario, eligiendo EXCLUSIVAMENTE entre una lista de capas que están
realmente cargadas en el mapa. No inventes capas que no estén en la lista.
Ten en cuenta en el prompt de usuario la entidad que se indica para hacer una valoración de que tipo de capa puede ser la más adecuada.
La capa de ríos tiene las siguientes entidades: Ebro, Duero, Tajo, Guadalquivir, Júcar, Segura, Miño y Guadiana.

Responde solo con JSON, sin texto adicional:
{"layer_id":"<id exacto de la lista>"} si encuentras una coincidencia razonable
{"layer_id":null} si ninguna capa de la lista encaja con la petición`;

// Decide qué capa usar. Función normal (no nodo de LangGraph, no usa
// interrupt): la llaman runQueryLayerGraph y runBufferEntityGraph antes de
// construir/ejecutar su StateGraph. Devuelve { selectedLayerId } si el LLM
// decide con confianza, o { needsSelection: true, options } si hace falta
// preguntar al usuario.
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

// Nodo de LangGraph: carga el esquema real de campos de la capa ya
// elegida. Requiere en el estado: view, selectedLayerId.
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