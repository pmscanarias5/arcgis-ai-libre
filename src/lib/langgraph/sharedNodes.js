import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { ResolveCandidateSchema, SelectLayerSchema } from "../llm/schemas.js";
import { describeLayersForPrompt } from "./layerCatalog.js";

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

export function findBestField(fields, hint) {
  const target = normalize(hint);
  if (!target) return null;
  return fields.find((f) => normalize(f.name).includes(target) || normalize(f.alias).includes(target)) || null;
}

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

export async function resolveAmbiguousValue(userPrompt, candidates) {
  if (candidates.length === 1) return candidates[0];

  const disambiguation = await callStructuredLLM(
    RESOLVE_CANDIDATE_PROMPT,
    [
      {
        role: "user",
        content: `Petición original: "${userPrompt}"\nCoincidencias encontradas: ${candidates
          .map((c) => `"${c}"`)
          .join(", ")}`
      }
    ],
    ResolveCandidateSchema
  );

  return candidates.includes(disambiguation?.match) ? disambiguation.match : candidates[0];
}

// Tipos de campo de ArcGIS que representan números: para estos, el filtro
// se construye como comparación numérica directa, nunca como LIKE de texto.
const NUMERIC_FIELD_TYPES = ["small-integer", "integer", "single", "double", "long", "big-integer"];
const VALID_OPERATORS = ["=", ">", ">=", "<", "<=", "!="];

async function resolveCondition(state, filter) {
  const fieldHint = filter?.field_hint;
  const valueHint = filter?.value_hint;
  if (!fieldHint || valueHint == null) return null;

  const filterField = findBestField(state.fields, fieldHint);
  if (!filterField) return null;

  if (NUMERIC_FIELD_TYPES.includes(filterField.type)) {
    const numericValue = Number(valueHint);
    if (Number.isNaN(numericValue)) return null;
    const operator = VALID_OPERATORS.includes(filter.operator) ? filter.operator : "=";
    return {
      clause: `${filterField.name} ${operator} ${numericValue}`,
      description: `${filterField.alias || filterField.name} ${operator} ${numericValue}`
    };
  }

  const candidates = await searchDistinctValues(state.layer, filterField, valueHint);
  if (candidates.length === 0) return null;
  const resolvedValue = await resolveAmbiguousValue(state.userPrompt, candidates);
  const safe = resolvedValue.replace(/'/g, "''");
  return {
    clause: `${filterField.name} = '${safe}'`,
    description: `${filterField.alias || filterField.name} = ${resolvedValue}`
  };
}

// Un grupo son condiciones combinadas con AND entre sí.
async function resolveConditionGroup(state, conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return null;

  const clauses = [];
  const descriptions = [];
  for (const condition of conditions) {
    const resolved = await resolveCondition(state, condition);
    if (!resolved) continue;
    clauses.push(resolved.clause);
    descriptions.push(resolved.description);
  }

  if (clauses.length === 0) return null;
  return { clause: clauses.join(" AND "), description: descriptions.join(", ") };
}

/**
 * Construye una cláusula WHERE a partir de las pistas que ha dado el LLM
 * (campo, valor, operador), resolviendo siempre contra el esquema y los
 * datos REALES de la capa. La usan tanto query_layer (filtro adicional a
 * su métrica) como select_features (condición de selección completa).
 *
 * "filterGroups" es una lista de grupos: las condiciones DENTRO de un mismo
 * grupo se combinan con AND, y los distintos grupos se combinan entre sí con
 * OR (forma normal disyuntiva), lo que permite expresar condiciones como
 * "provincia = Madrid o provincia = Barcelona" o combinaciones más complejas
 * tipo "(provincia = Sevilla AND poblacion > 50000) OR provincia = Cádiz".
 *
 * - Si un campo es numérico: comparación directa con el operador dado.
 * - Si un campo es de texto: se buscan candidatos reales que contengan el
 *   valor, se desambigua con el LLM si hay varios, y se usa "=" exacto.
 * - Si no hay pistas suficientes o no encajan con ningún campo real, esa
 *   condición/grupo se descarta (nunca se inventa un filtro); si no queda
 *   ningún grupo válido, devuelve whereClause: null.
 */
export async function resolveFilters(state, filterGroups) {
  if (!Array.isArray(filterGroups) || filterGroups.length === 0) {
    return { whereClause: null, filterDescription: null };
  }

  const groupClauses = [];
  const groupDescriptions = [];

  for (const group of filterGroups) {
    const resolved = await resolveConditionGroup(state, group?.conditions);
    if (!resolved) continue;
    groupClauses.push(resolved.clause);
    groupDescriptions.push(resolved.description);
  }

  if (groupClauses.length === 0) {
    return { whereClause: null, filterDescription: null };
  }

  const whereClause =
    groupClauses.length === 1 ? groupClauses[0] : groupClauses.map((c) => `(${c})`).join(" OR ");

  const filterDescription =
    groupDescriptions.length === 1
      ? groupDescriptions[0]
      : groupDescriptions.map((d) => `(${d})`).join(" o ");

  return { whereClause, filterDescription };
}

const SELECT_LAYER_PROMPT = `Eres un asistente que identifica a qué capa geográfica se refiere una
petición del usuario, eligiendo EXCLUSIVAMENTE entre una lista de capas que están
realmente cargadas en el mapa. No inventes capas que no estén en la lista.
Cada capa incluye su tipo de geometría y, cuando están disponibles, ejemplos reales
de sus datos: úsalos para razonar qué capa encaja mejor (p.ej. si la petición
menciona "el Tajo" y una capa tiene entre sus ejemplos "Tajo", es esa capa), no
te quedes solo con el título.

Responde solo con JSON, sin texto adicional:
{"layer_id":"<id exacto de la lista>"} si encuentras una coincidencia razonable
{"layer_id":null} si ninguna capa de la lista encaja con la petición`;

/**
 * Decide a qué capa se refiere la petición. Recibe las instancias reales de
 * capa (no solo {id, title}), porque necesita perfilarlas para dar contexto
 * de datos reales al LLM (ver layerCatalog.js). Devuelve { selectedLayerId }
 * si el LLM decide con confianza, o { needsSelection: true, options } (con
 * options ya en forma serializable {id, title}, la que consume la UI del
 * chat) si hace falta preguntar al usuario.
 */
export async function resolveLayer(userPrompt, layers) {
  const options = layers.map((l) => ({ id: l.id, title: l.title }));
  const layersDescription = await describeLayersForPrompt(layers);
  const userContent = `Capas cargadas en el mapa:\n${layersDescription}\n\nPetición del usuario: "${userPrompt}"`;

  const result = await callStructuredLLM(
    SELECT_LAYER_PROMPT,
    [{ role: "user", content: userContent }],
    SelectLayerSchema
  );

  const selectedLayerId = result?.layer_id ?? null;

  const isValid = options.some((l) => l.id === selectedLayerId);
  if (!isValid) {
    return { needsSelection: true, options };
  }
  return { selectedLayerId };
}

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