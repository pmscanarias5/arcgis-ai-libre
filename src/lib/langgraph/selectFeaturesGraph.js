import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { SelectFeaturesSchema } from "../llm/schemas.js";
import { resolveLayer, loadSchemaNode, resolveFilters } from "./sharedNodes.js";
import { setSelectionHighlight } from "../mapActions/selectionState.js";

const SelectFeaturesState = Annotation.Root({
  userPrompt: Annotation(),
  view: Annotation(),
  selectedLayerId: Annotation(),
  layer: Annotation(),
  fields: Annotation(),
  whereClause: Annotation(),
  filterDescription: Annotation(),
  resultText: Annotation()
});

const SELECT_FEATURES_PROMPT = `Eres un asistente que construye la condición de una selección de
entidades sobre una capa GIS, a partir de su esquema real de campos. No inventes
nombres de campo: usa solo palabras clave que probablemente aparezcan en su nombre
o alias, la propia aplicación se encarga de emparejarlas con el campo real.

Responde solo con JSON, sin texto adicional:
{"filters":[{"field_hint":"<palabra clave del campo>","value_hint":"<valor>","operator":"=|>|>=|<|<=|!="}]}

"filters" es una lista de condiciones combinadas SIEMPRE con AND. Usa un elemento
por cada restricción independiente que mencione la petición, no las mezcles en una
sola.

Ejemplo: "selecciona los municipios con más de 50000 habitantes" ->
filters:[{"field_hint":"poblacion","value_hint":"50000","operator":">"}]

Ejemplo: "selecciona los municipios de la comunidad de madrid con más de 5000 habitantes" ->
filters:[
  {"field_hint":"provincia","value_hint":"Madrid","operator":"="},
  {"field_hint":"poblacion","value_hint":"5000","operator":">"}
]`;

async function buildSelectionNode(state) {
  const fieldsDescription = state.fields
    .map((f) => `- ${f.name} (alias: "${f.alias}", tipo: ${f.type})`)
    .join("\n");

  const userContent = `Campos disponibles en la capa "${state.layer.title}":\n${fieldsDescription}\n\nPetición del usuario: "${state.userPrompt}"`;
  const result = await callStructuredLLM(SELECT_FEATURES_PROMPT, [{ role: "user", content: userContent }], SelectFeaturesSchema);

  const { whereClause, filterDescription } = await resolveFilters(state, result?.filters);

  if (!whereClause) {
    return { resultText: "No he identificado ninguna condición clara para hacer la selección." };
  }

  return { whereClause, filterDescription };
}

async function executeSelectionNode(state) {
  const { layer, view } = state;
  const filterSuffix = state.filterDescription ? ` (${state.filterDescription})` : "";

  const query = layer.createQuery();
  query.where = state.whereClause;
  query.outFields = [layer.objectIdField];
  query.returnGeometry = true;

  const result = await layer.queryFeatures(query);
  if (!result.features.length) {
    return { resultText: `No he encontrado ningún elemento en <b>${layer.title}</b>${filterSuffix}.` };
  }

  const objectIds = result.features.map((f) => f.attributes[layer.objectIdField]);

  const layerView = await view.whenLayerView(layer);
  const highlightHandle = layerView.highlight(objectIds);
  setSelectionHighlight(layer.id, highlightHandle);

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

export async function runSelectFeaturesGraph(view, userPrompt) {
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
        const finalState = await selectFeaturesGraph.invoke({ userPrompt, view, selectedLayerId: chosenLayerId });
        return finalState.resultText || "No he podido completar la selección.";
      }
    };
  }

  const finalState = await selectFeaturesGraph.invoke({
    userPrompt,
    view,
    selectedLayerId: layerResult.selectedLayerId
  });
  return finalState.resultText || "No he podido completar la selección.";
}