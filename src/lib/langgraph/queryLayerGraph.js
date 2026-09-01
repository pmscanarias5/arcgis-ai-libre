import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { BuildQuerySchema } from "../llm/schemas.js";
import {
  resolveLayer,
  loadSchemaNode,
  findLabelField,
  findBestField,
  searchDistinctValues,
  resolveAmbiguousValue
} from "./sharedNodes.js";

const QueryLayerState = Annotation.Root({
  userPrompt: Annotation(),
  view: Annotation(),
  selectedLayerId: Annotation(),
  layer: Annotation(),
  fields: Annotation(),
  metricField: Annotation(),
  labelField: Annotation(),
  order: Annotation(),
  limit: Annotation(),
  whereClause: Annotation(),
  filterDescription: Annotation(),
  resultText: Annotation()
});

// Tipos de campo de ArcGIS que representan números: para estos, el filtro
// se construye como comparación numérica directa, nunca como LIKE de texto.
const NUMERIC_FIELD_TYPES = ["small-integer", "integer", "single", "double", "long", "big-integer"];
const VALID_OPERATORS = ["=", ">", ">=", "<", "<=", "!="];

const BUILD_QUERY_PROMPT = `Eres un asistente que construye los parámetros de una consulta de
atributos sobre una capa GIS, a partir de su esquema real de campos. No inventes
nombres de campo que no estén en la lista proporcionada: usa solo palabras clave
que probablemente aparezcan en su nombre o alias, la propia aplicación se encarga
de emparejarlas con el campo real.

Responde solo con JSON, sin texto adicional:
{
  "metric_field_hint":"<palabra clave del campo a analizar, o null si solo se pide contar>",
  "order":"desc|asc",
  "limit":<num entre 1 y 10>,
  "filter_field_hint":"<palabra clave de un campo por el que FILTRAR los resultados, o null>",
  "filter_value_hint":"<valor por el que filtrar ese campo, o null>",
  "filter_operator":"=|>|>=|<|<=|!=|null"
}

filter_operator indica cómo comparar filter_value_hint con el campo de filtro:
usa ">" para "más de"/"por encima de", ">=" para "al menos"/"mínimo", "<" para
"menos de"/"por debajo de", "<=" para "como mucho"/"máximo", "=" para una
coincidencia exacta o un nombre de texto (una provincia, un municipio...), y null
si la petición no filtra nada.

Ejemplo: "el municipio más poblado con altitud de más de 1000 metros" ->
metric_field_hint:"poblacion", filter_field_hint:"altura", filter_value_hint:"1000",
filter_operator:">".

Ejemplo: "el municipio más poblado de la provincia de Málaga" ->
metric_field_hint:"poblacion", filter_field_hint:"provincia", filter_value_hint:"Malaga",
filter_operator:"=".

"order" es "desc" para el valor mayor (más poblado, máximo) o "asc" para el menor.
Por defecto "desc" y limit 1.`;

async function resolveFilter(state, result) {
  if (!result?.filter_field_hint || result?.filter_value_hint == null) {
    return { whereClause: null, filterDescription: null };
  }

  const filterField = findBestField(state.fields, result.filter_field_hint);
  if (!filterField) {
    // No hay campo real que encaje con la pista del LLM: seguimos sin
    // filtro en vez de fallar del todo.
    return { whereClause: null, filterDescription: null };
  }

  // Campo numérico: comparación directa, nunca LIKE de texto.
  if (NUMERIC_FIELD_TYPES.includes(filterField.type)) {
    const numericValue = Number(result.filter_value_hint);
    if (Number.isNaN(numericValue)) {
      return { whereClause: null, filterDescription: null };
    }
    const operator = VALID_OPERATORS.includes(result.filter_operator) ? result.filter_operator : "=";
    return {
      whereClause: `${filterField.name} ${operator} ${numericValue}`,
      filterDescription: `${filterField.alias || filterField.name} ${operator} ${numericValue}`
    };
  }

  // Campo de texto: se mantiene el flujo anterior, contrastando contra
  // valores reales de la capa antes de usar "=" exacto.
  const candidates = await searchDistinctValues(state.layer, filterField, result.filter_value_hint);
  if (candidates.length === 0) {
    return { whereClause: null, filterDescription: null };
  }
  const resolvedValue = await resolveAmbiguousValue(state.userPrompt, candidates);
  const safe = resolvedValue.replace(/'/g, "''");
  return {
    whereClause: `${filterField.name} = '${safe}'`,
    filterDescription: `${filterField.alias || filterField.name} = ${resolvedValue}`
  };
}

async function buildQueryNode(state) {
  const fieldsDescription = state.fields
    .map((f) => `- ${f.name} (alias: "${f.alias}", tipo: ${f.type})`)
    .join("\n");

  const userContent = `Campos disponibles en la capa "${state.layer.title}":\n${fieldsDescription}\n\nPetición del usuario: "${state.userPrompt}"`;
  const result = await callStructuredLLM(BUILD_QUERY_PROMPT, [{ role: "user", content: userContent }], BuildQuerySchema);

  const metricField = result?.metric_field_hint ? findBestField(state.fields, result.metric_field_hint) : null;
  const order = result?.order === "asc" ? "asc" : "desc";
  const limit = Math.max(1, Math.min(result?.limit || 1, 10));
  const labelField = findLabelField(state.fields, state.layer.displayField);

  const { whereClause: filterClause, filterDescription } = await resolveFilter(state, result);

  const baseClause = metricField ? `${metricField.name} IS NOT NULL` : "1=1";
  const whereClause = filterClause ? `${baseClause} AND ${filterClause}` : baseClause;

  return { metricField, labelField, order, limit, whereClause, filterDescription };
}

async function executeQueryNode(state) {
  const { layer, view } = state;
  const filterSuffix = state.filterDescription ? ` (${state.filterDescription})` : "";

  if (!state.metricField) {
    const countQuery = layer.createQuery();
    countQuery.where = state.whereClause;
    const count = await layer.queryFeatureCount(countQuery);
    return { resultText: `La capa <b>${layer.title}</b>${filterSuffix} tiene <b>${count}</b> elemento(s).` };
  }

  const query = layer.createQuery();
  query.where = state.whereClause;
  query.orderByFields = [`${state.metricField.name} ${state.order.toUpperCase()}`];
  query.outFields = state.labelField
    ? [state.metricField.name, state.labelField.name]
    : [state.metricField.name];
  query.num = state.limit;
  query.returnGeometry = true;

  const result = await layer.queryFeatures(query);
  if (!result.features.length) {
    return { resultText: `No he encontrado datos en <b>${layer.title}</b>${filterSuffix} para lo que pides.` };
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
      ? `El elemento con ${qualifier} <b>${state.metricField.alias || state.metricField.name}</b> en <b>${layer.title}</b>${filterSuffix}`
      : `Los ${state.limit} elementos con ${qualifier} <b>${state.metricField.alias || state.metricField.name}</b> en <b>${layer.title}</b>${filterSuffix}`;

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

const graph = new StateGraph(QueryLayerState)
  .addNode("loadSchema", loadSchemaNode)
  .addNode("buildQuery", buildQueryNode)
  .addNode("executeQuery", executeQueryNode)
  .addEdge(START, "loadSchema")
  .addConditionalEdges("loadSchema", (state) => (state.resultText ? END : "buildQuery"))
  .addEdge("buildQuery", "executeQuery")
  .addEdge("executeQuery", END);

const queryLayerGraph = graph.compile();

export async function runQueryLayerGraph(view, userPrompt) {
  const availableLayers = view.map.layers.toArray().map((l) => ({ id: l.id, title: l.title }));

  if (availableLayers.length === 0) {
    return "No hay ninguna capa operativa cargada en el mapa todavía.";
  }

  const layerResult = await resolveLayer(userPrompt, availableLayers);

  if (layerResult.needsSelection) {
    return {
      needsInput: true,
      question: "No he identificado con certeza a qué capa te refieres. ¿Cuál de estas es?",
      options: layerResult.options,
      resume: async (chosenLayerId) => {
        const finalState = await queryLayerGraph.invoke({ userPrompt, view, selectedLayerId: chosenLayerId });
        return finalState.resultText || "No he podido completar la consulta.";
      }
    };
  }

  const finalState = await queryLayerGraph.invoke({
    userPrompt,
    view,
    selectedLayerId: layerResult.selectedLayerId
  });
  return finalState.resultText || "No he podido completar la consulta.";
}