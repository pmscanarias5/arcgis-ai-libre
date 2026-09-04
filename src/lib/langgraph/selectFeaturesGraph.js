import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { SelectFeaturesSchema } from "../llm/schemas.js";
import { resolveLayer, loadSchemaNode, resolveFilters, findBestField, formatConversationHistory } from "./sharedNodes.js";
import { getLayerProfile, describeFieldsForPrompt } from "./layerCatalog.js";
import { applySelection } from "../mapActions/selectionSync.js";

const SelectFeaturesState = Annotation.Root({
  userPrompt: Annotation(),
  history: Annotation(),
  view: Annotation(),
  selectedLayerId: Annotation(),
  layer: Annotation(),
  fields: Annotation(),
  whereClause: Annotation(),
  filterDescription: Annotation(),
  metricField: Annotation(),
  order: Annotation(),
  limit: Annotation(),
  resultText: Annotation()
});

const SELECT_FEATURES_PROMPT = `Eres un asistente que construye la condición de una selección de
entidades sobre una capa GIS, a partir de su esquema real de campos. No inventes
nombres de campo: usa solo palabras clave que probablemente aparezcan en su nombre
o alias, la propia aplicación se encarga de emparejarlas con el campo real.

Responde solo con JSON, sin texto adicional:
{
  "metric_field_hint":"<palabra clave del campo a ordenar, o null si no se pide un ranking>",
  "order":"desc|asc",
  "limit":<num entre 1 y 50, o null si no se pide un top-N>,
  "filter_groups":[{"conditions":[{"field_hint":"<palabra clave del campo>","value_hint":"<valor>","operator":"=|>|>=|<|<=|!="}]}]
}

"filter_groups" es una lista de grupos de condiciones. Las condiciones DENTRO de
un mismo grupo se combinan con AND. Los distintos grupos se combinan entre sí con
OR: usa varios grupos solo cuando la petición tenga una disyunción real (un "o"
que amplía las opciones). Si no hay ningún "o", usa un único grupo con todas las
condiciones. Puede ir vacía si la selección es puramente un ranking (ver más abajo).

Ejemplo: "selecciona los municipios con más de 50000 habitantes" ->
metric_field_hint:null, limit:null, filter_groups:[
  {"conditions":[{"field_hint":"poblacion","value_hint":"50000","operator":">"}]}
]

Ejemplo: "selecciona los municipios de la comunidad de madrid con más de 5000 habitantes" ->
metric_field_hint:null, limit:null, filter_groups:[
  {"conditions":[
    {"field_hint":"provincia","value_hint":"Madrid","operator":"="},
    {"field_hint":"poblacion","value_hint":"5000","operator":">"}
  ]}
]

Ejemplo (disyunción con "o"): "selecciona los municipios de Madrid o de Barcelona" ->
metric_field_hint:null, limit:null, filter_groups:[
  {"conditions":[{"field_hint":"provincia","value_hint":"Madrid","operator":"="}]},
  {"conditions":[{"field_hint":"provincia","value_hint":"Barcelona","operator":"="}]}
]

Ejemplo (OR combinado con AND): "marca los municipios de Sevilla con más de 50000
habitantes o de Cádiz con más de 20000 habitantes" -> filter_groups:[
  {"conditions":[
    {"field_hint":"provincia","value_hint":"Sevilla","operator":"="},
    {"field_hint":"poblacion","value_hint":"50000","operator":">"}
  ]},
  {"conditions":[
    {"field_hint":"provincia","value_hint":"Cadiz","operator":"="},
    {"field_hint":"poblacion","value_hint":"20000","operator":">"}
  ]}
]

Si la petición es del tipo "selecciona/marca/resalta los N más/menos <adjetivo>" (un
ranking, ordenar y quedarse con los N primeros/últimos), usa "metric_field_hint",
"order" y "limit" en vez de (o además de) "filter_groups":

Ejemplo: "selecciona los dos ríos más largos de España" ->
metric_field_hint:"longitud", order:"desc", limit:2, filter_groups:[]

"order" es "desc" para el valor mayor (más largo, más poblado) o "asc" para el menor.

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

async function buildSelectionNode(state) {
  const profile = await getLayerProfile(state.layer);
  const fieldsDescription = describeFieldsForPrompt(profile);

  const userContent = `${formatConversationHistory(state.history)}Campos disponibles en la capa "${state.layer.title}":\n${fieldsDescription}\n\nPetición del usuario: "${state.userPrompt}"`;
  const result = await callStructuredLLM(SELECT_FEATURES_PROMPT, [{ role: "user", content: userContent }], SelectFeaturesSchema);

  const metricField = result?.metric_field_hint ? findBestField(state.fields, result.metric_field_hint) : null;
  const order = result?.order === "asc" ? "asc" : "desc";
  const limit = metricField && result?.limit ? Math.max(1, Math.min(result.limit, 50)) : null;

  const { whereClause: filterClause, filterDescription } = await resolveFilters(state, result?.filter_groups);

  if (!filterClause && !metricField) {
    return { resultText: "No he identificado ninguna condición clara para hacer la selección." };
  }

  return {
    whereClause: filterClause || "1=1",
    filterDescription,
    metricField,
    order,
    limit
  };
}

async function executeSelectionNode(state) {
  const { layer, view } = state;
  const filterSuffix = state.filterDescription ? ` (${state.filterDescription})` : "";

  const query = layer.createQuery();
  query.where = state.whereClause;
  query.outFields = [layer.objectIdField];
  query.returnGeometry = true;

  if (state.metricField) {
    query.orderByFields = [`${state.metricField.name} ${state.order.toUpperCase()}`];
  }
  if (state.limit) {
    query.num = state.limit;
  }

  const result = await layer.queryFeatures(query);
  if (!result.features.length) {
    return { resultText: `No he encontrado ningún elemento en <b>${layer.title}</b>${filterSuffix}.` };
  }

  const objectIds = result.features.map((f) => f.attributes[layer.objectIdField]);

  await applySelection(view, layer, objectIds);

  const geometries = result.features.map((f) => f.geometry).filter(Boolean);
  if (geometries.length === 1) {
    await view.goTo(geometries[0]);
  } else if (geometries.length > 1) {
    await view.goTo(geometries);
  }

  return {
    resultText: `He seleccionado <b>${result.features.length}</b> elemento(s) en <b>${layer.title}</b>${filterSuffix}. Se han resaltado en el mapa.`
  };
}

const graph = new StateGraph(SelectFeaturesState)
  .addNode("loadSchema", loadSchemaNode)
  .addNode("buildSelection", buildSelectionNode)
  .addNode("executeSelection", executeSelectionNode)
  .addEdge(START, "loadSchema")
  .addConditionalEdges("loadSchema", (state) => (state.resultText ? END : "buildSelection"))
  .addConditionalEdges("buildSelection", (state) => (state.resultText ? END : "executeSelection"))
  .addEdge("executeSelection", END);

const selectFeaturesGraph = graph.compile();

export async function runSelectFeaturesGraph(view, userPrompt, history = []) {
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
        const finalState = await selectFeaturesGraph.invoke({ userPrompt, view, selectedLayerId: chosenLayerId, history });
        return finalState.resultText || "No he podido completar la selección.";
      }
    };
  }

  const finalState = await selectFeaturesGraph.invoke({
    userPrompt,
    view,
    selectedLayerId: layerResult.selectedLayerId,
    history
  });
  return finalState.resultText || "No he podido completar la selección.";
}