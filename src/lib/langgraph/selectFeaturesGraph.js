import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { SelectFeaturesSchema } from "../llm/schemas.js";
import {
  resolveLayer,
  loadSchemaNode,
  resolveFilters,
  findBestField,
  formatConversationHistory,
  resolveSpatialFilter
} from "./sharedNodes.js";
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
  spatialGeometry: Annotation(),
  spatialRelation: Annotation(),
  spatialDescription: Annotation(),
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
  "filter_groups":[{"conditions":[{"field_hint":"<palabra clave del campo>","value_hint":"<valor>","operator":"=|>|>=|<|<=|!="}]}],
  "spatial_filter":null
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
antes, filter_groups igual que antes (provincia = Madrid, aunque no se repita).

Además de "filter_groups" (condiciones sobre los propios atributos), la
petición puede pedir una relación ESPACIAL con otra entidad o capa (p.ej.
"que intersecan con...", "dentro de...", "que contienen...", "que tocan...",
"que cruzan...", "que se solapan con...", "que pasan por...", "que
atraviesan...", "que recorren..."). En ese caso añade:

"spatial_filter": {
  "relation":"intersects|contains|within|touches|crosses|overlaps|disjoint",
  "reference":"buffer|layer_entity",
  "target_layer_hint":"<palabra clave de la OTRA capa, o null si no sabes en qué capa está o reference es buffer>",
  "target_entity_hint":"<nombre de la entidad a buscar, o null si reference es buffer>"
}

Usa "reference":"buffer" cuando la petición se refiere a un área de
influencia o buffer creado antes en la conversación ("ese buffer", "el área
de influencia anterior", "la zona que generamos antes"). Usa
"reference":"layer_entity" cuando nombra un lugar concreto (aunque no diga
explícitamente de qué tipo de capa es: un municipio, río, provincia... puede
nombrarse solo por su nombre propio, como "Cullera" o "el Tajo").
"target_layer_hint" es OPCIONAL: si no tienes certeza de en qué capa está esa
entidad, déjalo en null — la aplicación busca automáticamente en qué capa
real está, no hace falta que lo adivines tú.
Si no hay ninguna relación espacial en la petición, usa "spatial_filter":null.

Ejemplo: "selecciona los ríos que intersecan con la provincia de Guadalajara" ->
spatial_filter:{"relation":"intersects","reference":"layer_entity","target_layer_hint":"provincia","target_entity_hint":"Guadalajara"}

Ejemplo: "qué ríos pasan por Cullera" (no se sabe de qué tipo de lugar es
Cullera) -> spatial_filter:{"relation":"intersects","reference":"layer_entity","target_layer_hint":null,"target_entity_hint":"Cullera"}

Ejemplo: "los municipios que están completamente dentro de ese buffer" ->
spatial_filter:{"relation":"within","reference":"buffer","target_layer_hint":null,"target_entity_hint":null}`;

async function buildSelectionNode(state) {
  const profile = await getLayerProfile(state.layer);
  const fieldsDescription = describeFieldsForPrompt(profile);

  const userContent = [
    `Petición del usuario: "${state.userPrompt}"`,
    `Campos disponibles en la capa "${state.layer.title}":\n${fieldsDescription}`,
    formatConversationHistory(state.history)
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await callStructuredLLM(SELECT_FEATURES_PROMPT, [{ role: "user", content: userContent }], SelectFeaturesSchema);

  const metricField = result?.metric_field_hint ? findBestField(state.fields, result.metric_field_hint) : null;
  const order = result?.order === "asc" ? "asc" : "desc";
  const limit = metricField && result?.limit ? Math.max(1, Math.min(result.limit, 50)) : null;

  const { whereClause: filterClause, filterDescription } = await resolveFilters(state, result?.filter_groups);

  let spatialGeometry = null;
  let spatialRelation = null;
  let spatialDescription = null;
  if (result?.spatial_filter) {
    const resolvedSpatial = await resolveSpatialFilter(result.spatial_filter, {
      view: state.view,
      userPrompt: state.userPrompt,
      excludeLayerId: state.layer.id
    });
    if (!resolvedSpatial) {
      return { resultText: "No he podido identificar la entidad o el buffer de referencia para aplicar la relación espacial." };
    }
    spatialGeometry = resolvedSpatial.geometry;
    spatialRelation = resolvedSpatial.relation;
    spatialDescription = resolvedSpatial.description;
  }

  if (!filterClause && !metricField && !spatialGeometry) {
    return { resultText: "No he identificado ninguna condición clara para hacer la selección." };
  }

  return {
    whereClause: filterClause || "1=1",
    filterDescription,
    metricField,
    order,
    limit,
    spatialGeometry,
    spatialRelation,
    spatialDescription
  };
}

async function executeSelectionNode(state) {
  const { layer, view } = state;
  const descriptionParts = [state.filterDescription, state.spatialDescription].filter(Boolean);
  const filterSuffix = descriptionParts.length ? ` (${descriptionParts.join(", ")})` : "";

  const query = layer.createQuery();
  query.where = state.whereClause;
  query.outFields = [layer.objectIdField];
  query.returnGeometry = true;

  if (state.spatialGeometry) {
    query.geometry = state.spatialGeometry;
    query.spatialRelationship = state.spatialRelation;
  }

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
    resultText: `He seleccionado <b>${result.features.length}</b> elemento(s) en <b>${layer.title}</b>${filterSuffix}. Se han resaltado en el mapa. Puedes abrir la tabla de atributos de la capa para ver el detalle de cada entidad.`
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