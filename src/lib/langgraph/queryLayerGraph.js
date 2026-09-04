import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { BuildQuerySchema } from "../llm/schemas.js";
import {
  resolveLayer,
  loadSchemaNode,
  findLabelField,
  findBestField,
  resolveFilters,
  formatConversationHistory
} from "./sharedNodes.js";
import { getLayerProfile, describeFieldsForPrompt } from "./layerCatalog.js";

const QueryLayerState = Annotation.Root({
  userPrompt: Annotation(),
  history: Annotation(),
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
  "filter_groups":[{"conditions":[{"field_hint":"<palabra clave del campo>","value_hint":"<valor>","operator":"=|>|>=|<|<=|!="}]}]
}

"filter_groups" es una lista de grupos de condiciones que restringen los resultados.
Las condiciones DENTRO de un mismo grupo se combinan con AND. Los distintos grupos
se combinan entre sí con OR: usa varios grupos solo cuando la petición tenga una
disyunción real (un "o" que amplía las opciones). Si no hay ningún "o", usa un
único grupo con todas las condiciones.

Ejemplo: "el municipio más poblado con altitud de más de 1000 metros" ->
metric_field_hint:"poblacion", filter_groups:[
  {"conditions":[{"field_hint":"altura","value_hint":"1000","operator":">"}]}
]

Ejemplo: "el municipio más poblado de la provincia de Málaga con más de 1000m de altitud" ->
metric_field_hint:"poblacion", filter_groups:[
  {"conditions":[
    {"field_hint":"provincia","value_hint":"Malaga","operator":"="},
    {"field_hint":"altura","value_hint":"1000","operator":">"}
  ]}
]

Ejemplo (disyunción con "o"): "el municipio más poblado de Madrid o de Barcelona" ->
metric_field_hint:"poblacion", filter_groups:[
  {"conditions":[{"field_hint":"provincia","value_hint":"Madrid","operator":"="}]},
  {"conditions":[{"field_hint":"provincia","value_hint":"Barcelona","operator":"="}]}
]

Ejemplo (OR combinado con AND): "municipios de Sevilla con más de 50000 habitantes o
de Cádiz con más de 20000 habitantes" -> filter_groups:[
  {"conditions":[
    {"field_hint":"provincia","value_hint":"Sevilla","operator":"="},
    {"field_hint":"poblacion","value_hint":"50000","operator":">"}
  ]},
  {"conditions":[
    {"field_hint":"provincia","value_hint":"Cadiz","operator":"="},
    {"field_hint":"poblacion","value_hint":"20000","operator":">"}
  ]}
]

"order" es "desc" para el valor mayor (más poblado, máximo) o "asc" para el menor.
Por defecto "desc" y limit 1.

Si la petición actual solo cambia un detalle (el lugar, el orden, el número
de elementos...) y omite el resto, recupera lo que falte del contexto de la
conversación anterior; lo que la petición actual SÍ mencione tiene siempre
prioridad sobre el contexto.
Ejemplo: contexto "Asistente: He seleccionado los 3 municipios con mayor
superficie en Municipios (provincia = Madrid)." + petición actual "y ahora
los de Granada" -> metric_field_hint:"superficie", order:"desc", limit:3,
filter_groups:[{"conditions":[{"field_hint":"provincia","value_hint":"Granada","operator":"="}]}]
Ejemplo: contexto "Asistente: ... el municipio más poblado en Municipios
(provincia = Madrid) ..." + petición actual "¿y el menos poblado?" ->
metric_field_hint:"poblacion", order:"asc" (se invierte), limit igual que
antes, filter_groups igual que antes (provincia = Madrid, aunque no se repita).`;



async function buildQueryNode(state) {
  const profile = await getLayerProfile(state.layer);
  const fieldsDescription = describeFieldsForPrompt(profile);

  const userContent = `${formatConversationHistory(state.history)}Campos disponibles en la capa "${state.layer.title}":\n${fieldsDescription}\n\nPetición del usuario: "${state.userPrompt}"`;
  const result = await callStructuredLLM(BUILD_QUERY_PROMPT, [{ role: "user", content: userContent }], BuildQuerySchema);

  const metricField = result?.metric_field_hint ? findBestField(state.fields, result.metric_field_hint) : null;
  const order = result?.order === "asc" ? "asc" : "desc";
  const limit = Math.max(1, Math.min(result?.limit || 1, 10));
  const labelField = findLabelField(state.fields, state.layer.displayField);

  const { whereClause: filterClause, filterDescription } = await resolveFilters(state, result?.filter_groups);

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

export async function runQueryLayerGraph(view, userPrompt, history = []) {
  const availableLayers = view.map.layers.toArray();

  if (availableLayers.length === 0) {
    return "No hay ninguna capa operativa cargada en el mapa todavía.";
  }

  const layerResult = await resolveLayer(userPrompt, availableLayers, history);

  if (layerResult.needsSelection) {
    return {
      needsInput: true,
      question: "No he identificado con certeza a qué capa te refieres. ¿Cuál de estas es?",
      options: layerResult.options,
      resume: async (chosenLayerId) => {
        const finalState = await queryLayerGraph.invoke({ userPrompt, view, selectedLayerId: chosenLayerId, history });
        return finalState.resultText || "No he podido completar la consulta.";
      }
    };
  }

  const finalState = await queryLayerGraph.invoke({
    userPrompt,
    view,
    selectedLayerId: layerResult.selectedLayerId,
    history
  });
  return finalState.resultText || "No he podido completar la consulta.";
}