import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";

// Estado compartido entre los nodos del grafo. `view` y `layer` guardan
// referencias directas a instancias del SDK de ArcGIS: al no usar ningún
// checkpointer (todo corre en memoria, en el propio navegador, en una sola
// pasada), no hace falta que el estado sea serializable.
const QueryLayerState = Annotation.Root({
  userPrompt: Annotation(),
  availableLayers: Annotation(),
  view: Annotation(),
  selectedLayerId: Annotation(),
  layer: Annotation(),
  fields: Annotation(),
  metricField: Annotation(),
  labelField: Annotation(),
  order: Annotation(),
  limit: Annotation(),
  resultText: Annotation()
});

function normalize(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findLabelField(fields, displayFieldName) {
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

// --- Nodo 1: decidir qué capa, viendo la lista real de capas cargadas ---
const SELECT_LAYER_PROMPT = `Eres un asistente que identifica a qué capa geográfica se refiere una
petición del usuario, eligiendo EXCLUSIVAMENTE entre una lista de capas que están
realmente cargadas en el mapa. No inventes capas que no estén en la lista.

Responde solo con JSON, sin texto adicional:
{"layer_id":"<id exacto de la lista>"} si encuentras una coincidencia razonable
{"layer_id":null} si ninguna capa de la lista encaja con la petición`;

async function selectLayerNode(state) {
  const layersDescription = state.availableLayers
    .map((l) => `- id: "${l.id}", título: "${l.title}"`)
    .join("\n");

  const userContent = `Capas cargadas en el mapa:\n${layersDescription}\n\nPetición del usuario: "${state.userPrompt}"`;
  const result = await callStructuredLLM(SELECT_LAYER_PROMPT, [{ role: "user", content: userContent }]);
  const selectedLayerId = result?.layer_id ?? null;

  if (!selectedLayerId) {
    return { resultText: "No he identificado ninguna capa cargada que encaje con tu petición." };
  }
  return { selectedLayerId };
}

// --- Nodo 2: cargar el esquema real de campos de la capa elegida (sin LLM) ---
async function loadSchemaNode(state) {
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

// --- Nodo 3: construir la consulta viendo los campos reales de esa capa ---
const BUILD_QUERY_PROMPT = `Eres un asistente que construye los parámetros de una consulta de
atributos sobre una capa GIS, a partir de su esquema real de campos. No inventes
nombres de campo que no estén en la lista proporcionada.

Responde solo con JSON, sin texto adicional:
{"metric_field":"<nombre exacto de campo, o null si solo se pide contar elementos>","order":"desc|asc","limit":<num entre 1 y 10>}

"order" es "desc" para el valor mayor (más poblado, máximo) o "asc" para el menor.
Por defecto "desc" y limit 1.`;

async function buildQueryNode(state) {
  const fieldsDescription = state.fields
    .map((f) => `- ${f.name} (alias: "${f.alias}", tipo: ${f.type})`)
    .join("\n");

  const userContent = `Campos disponibles en la capa "${state.layer.title}":\n${fieldsDescription}\n\nPetición del usuario: "${state.userPrompt}"`;
  const result = await callStructuredLLM(BUILD_QUERY_PROMPT, [{ role: "user", content: userContent }]);

  const metricField = result?.metric_field
    ? state.fields.find((f) => f.name === result.metric_field) || null
    : null;

  return {
    metricField,
    labelField: findLabelField(state.fields, state.layer.displayField),
    order: result?.order === "asc" ? "asc" : "desc",
    limit: Math.max(1, Math.min(result?.limit || 1, 10))
  };
}

// --- Nodo 4: ejecutar contra el FeatureServer y hacer zoom sobre el resultado ---
async function executeQueryNode(state) {
  const { layer, view } = state;

  if (!state.metricField) {
    const count = await layer.queryFeatureCount();
    return { resultText: `La capa <b>${layer.title}</b> tiene <b>${count}</b> elemento(s).` };
  }

  const query = layer.createQuery();
  query.where = `${state.metricField.name} IS NOT NULL`;
  query.orderByFields = [`${state.metricField.name} ${state.order.toUpperCase()}`];
  query.outFields = state.labelField
    ? [state.metricField.name, state.labelField.name]
    : [state.metricField.name];
  query.num = state.limit;
  query.returnGeometry = true;

  const result = await layer.queryFeatures(query);
  if (!result.features.length) {
    return { resultText: `No he encontrado datos en <b>${layer.title}</b> para lo que pides.` };
  }

  const items = result.features
    .map((f) => {
      const label = state.labelField ? f.attributes[state.labelField.name] : "—";
      const value = f.attributes[state.metricField.name];
      return `<li>${label}: <b>${value}</b></li>`;
    })
    .join("");

  const qualifier = state.order === "desc" ? "mayor" : "menor";
  const heading =
    state.limit === 1
      ? `El elemento con ${qualifier} <b>${state.metricField.alias || state.metricField.name}</b> en <b>${layer.title}</b>`
      : `Los ${state.limit} elementos con ${qualifier} <b>${state.metricField.alias || state.metricField.name}</b> en <b>${layer.title}</b>`;

  // Zoom automático sobre los resultados (sin marcadores, según lo acordado)
  const geometries = result.features.map((f) => f.geometry).filter(Boolean);
  if (geometries.length === 1) {
    const geom = geometries[0];
    if (geom.type === "point") {
      await view.goTo({ target: geom, zoom: Math.max(view.zoom, 12) });
    } else {
      await view.goTo(geom);
    }
  } else if (geometries.length > 1) {
    await view.goTo(geometries);
  }

  return { resultText: `${heading}:<ul>${items}</ul>` };
}

function routeAfterSelectLayer(state) {
  return state.resultText ? END : "loadSchema";
}

function routeAfterLoadSchema(state) {
  return state.resultText ? END : "buildQuery";
}

const graph = new StateGraph(QueryLayerState)
  .addNode("selectLayer", selectLayerNode)
  .addNode("loadSchema", loadSchemaNode)
  .addNode("buildQuery", buildQueryNode)
  .addNode("executeQuery", executeQueryNode)
  .addEdge(START, "selectLayer")
  .addConditionalEdges("selectLayer", routeAfterSelectLayer)
  .addConditionalEdges("loadSchema", routeAfterLoadSchema)
  .addEdge("buildQuery", "executeQuery")
  .addEdge("executeQuery", END);

const queryLayerGraph = graph.compile();

export async function runQueryLayerGraph(view, userPrompt) {
  const availableLayers = view.map.layers.toArray().map((l) => ({ id: l.id, title: l.title }));

  if (availableLayers.length === 0) {
    return "No hay ninguna capa operativa cargada en el mapa todavía.";
  }

  const finalState = await queryLayerGraph.invoke({ userPrompt, availableLayers, view });
  return finalState.resultText || "No he podido completar la consulta.";
}