import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import Graphic from "@arcgis/core/Graphic";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { ExtractSearchTextSchema } from "../llm/schemas.js";
import {
  resolveLayer,
  loadSchemaNode,
  findLabelField,
  searchDistinctValues,
  resolveAmbiguousValue
} from "./sharedNodes.js";

const DEFAULT_DISTANCE_KM = 5;

const BufferEntityState = Annotation.Root({
  userPrompt: Annotation(),
  view: Annotation(),
  selectedLayerId: Annotation(),
  layer: Annotation(),
  fields: Annotation(),
  labelField: Annotation(),
  entityValue: Annotation(),
  distanceKm: Annotation(),
  resultText: Annotation()
});

const EXTRACT_SEARCH_TEXT_PROMPT = `Eres un asistente que extrae de la petición del usuario un texto
de búsqueda aproximado para localizar una entidad geográfica, y la distancia deseada
en kilómetros. No tienes que acertar el nombre exacto: solo un fragmento razonable
que probablemente aparezca en el dato real (puedes omitir tildes o palabras genéricas
como "municipio de").
En el caso de los ríos, debes usar el nombre del río directamente, por ejemplo quedate únicamente con "Ebro" o "Duero", aunque se te diga río Ebro o río Duero.

Responde solo con JSON, sin texto adicional:
{"search_text":"<fragmento de búsqueda>","distance_km":<num, o null si no se menciona>}`;

async function buildEntityQueryNode(state) {
  const labelField = findLabelField(state.fields, state.layer.displayField);
  if (!labelField) {
    return { resultText: `La capa <b>${state.layer.title}</b> no tiene ningún campo de nombre reconocible para buscar la entidad.` };
  }

  const extraction = await callStructuredLLM(EXTRACT_SEARCH_TEXT_PROMPT, [
    { role: "user", content: `Petición del usuario: "${state.userPrompt}"` }
  ], ExtractSearchTextSchema);

  const searchText = extraction?.search_text?.trim();
  const distanceKm = extraction?.distance_km || DEFAULT_DISTANCE_KM;

  if (!searchText) {
    return { resultText: "No he identificado sobre qué entidad quieres crear el área de influencia." };
  }

  const candidates = await searchDistinctValues(state.layer, labelField, searchText);

  if (candidates.length === 0) {
    return { resultText: `No he encontrado ninguna entidad en <b>${state.layer.title}</b> parecida a "${searchText}".` };
  }

  const entityValue = await resolveAmbiguousValue(state.userPrompt, candidates);
  return { labelField, entityValue, distanceKm };
}

async function executeBufferNode(state) {
  const { layer, view, labelField, entityValue, distanceKm } = state;

  const safeValue = entityValue.replace(/'/g, "''");
  const query = layer.createQuery();
  query.where = `${labelField.name} = '${safeValue}'`;
  query.outFields = [labelField.name];
  query.num = 1;
  query.returnGeometry = true;

  const result = await layer.queryFeatures(query);
  if (!result.features.length) {
    return { resultText: `No he podido recuperar la geometría de "${entityValue}" en <b>${layer.title}</b>.` };
  }

  const feature = result.features[0];
  const bufferGeom = geometryEngine.geodesicBuffer(feature.geometry, distanceKm, "kilometers");

  const graphic = new Graphic({
    geometry: bufferGeom,
    symbol: {
      type: "simple-fill",
      color: [0, 230, 195, 0.3],
      outline: { color: [0, 230, 195, 1], width: 2 }
    }
  });

  view.graphics.removeAll();
  view.graphics.add(graphic);
  await view.goTo(bufferGeom);

  return {
    resultText: `Se ha generado un área de influencia de <b>${distanceKm} km</b> alrededor de <b>${entityValue}</b> (capa <b>${layer.title}</b>).`
  };
}

const graph = new StateGraph(BufferEntityState)
  .addNode("loadSchema", loadSchemaNode)
  .addNode("buildEntityQuery", buildEntityQueryNode)
  .addNode("executeBuffer", executeBufferNode)
  .addEdge(START, "loadSchema")
  .addConditionalEdges("loadSchema", (state) => (state.resultText ? END : "buildEntityQuery"))
  .addConditionalEdges("buildEntityQuery", (state) => (state.resultText ? END : "executeBuffer"))
  .addEdge("executeBuffer", END);

const bufferEntityGraph = graph.compile();

export async function runBufferEntityGraph(view, userPrompt) {
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
        const finalState = await bufferEntityGraph.invoke({ userPrompt, view, selectedLayerId: chosenLayerId });
        return finalState.resultText || "No he podido completar el área de influencia.";
      }
    };
  }

  const finalState = await bufferEntityGraph.invoke({
    userPrompt,
    view,
    selectedLayerId: layerResult.selectedLayerId
  });
  return finalState.resultText || "No he podido completar el área de influencia.";
}