import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import Graphic from "@arcgis/core/Graphic";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { selectLayerNode, loadSchemaNode, findLabelField } from "./sharedNodes.js";

const DEFAULT_DISTANCE_KM = 5;

const BufferEntityState = Annotation.Root({
  userPrompt: Annotation(),
  availableLayers: Annotation(),
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

Responde solo con JSON, sin texto adicional:
{"search_text":"<fragmento de búsqueda>","distance_km":<num, o null si no se menciona>}`;

const RESOLVE_CANDIDATE_PROMPT = `Eres un asistente que, dada la petición original del usuario y una
lista de coincidencias reales encontradas en los datos, elige cuál de esas
coincidencias es la que el usuario quería decir.

Responde solo con JSON, sin texto adicional:
{"match":"<uno de los valores de la lista, copiado EXACTAMENTE tal cual>"}`;

// Consulta el FeatureServer real en busca de candidatos que contengan el
// texto de búsqueda, en vez de fiarnos a ciegas del texto que ha extraído
// el LLM. Esto es lo que da precisión: el LLM elige entre datos reales.
async function searchCandidates(layer, labelField, searchText) {
  const safe = searchText.replace(/'/g, "''");
  const query = layer.createQuery();
  query.where = `UPPER(${labelField.name}) LIKE UPPER('%${safe}%')`;
  query.outFields = [labelField.name];
  query.returnGeometry = false;
  query.num = 10;

  const result = await layer.queryFeatures(query);
  return [...new Set(result.features.map((f) => f.attributes[labelField.name]))];
}

async function buildEntityQueryNode(state) {
  const labelField = findLabelField(state.fields, state.layer.displayField);
  if (!labelField) {
    return { resultText: `La capa <b>${state.layer.title}</b> no tiene ningún campo de nombre reconocible para buscar la entidad.` };
  }

  // 1ª llamada: solo un texto de búsqueda aproximado, no el nombre "definitivo"
  const extraction = await callStructuredLLM(EXTRACT_SEARCH_TEXT_PROMPT, [
    { role: "user", content: `Petición del usuario: "${state.userPrompt}"` }
  ]);

  const searchText = extraction?.search_text?.trim();
  const distanceKm = extraction?.distance_km || DEFAULT_DISTANCE_KM;

  if (!searchText) {
    return { resultText: "No he identificado sobre qué entidad quieres crear el área de influencia." };
  }

  const candidates = await searchCandidates(state.layer, labelField, searchText);

  if (candidates.length === 0) {
    return { resultText: `No he encontrado ninguna entidad en <b>${state.layer.title}</b> parecida a "${searchText}".` };
  }

  let entityValue;
  if (candidates.length === 1) {
    // Coincidencia única: no hace falta gastar otra llamada al LLM
    entityValue = candidates[0];
  } else {
    // 2ª llamada: desambiguar entre coincidencias REALES, no inventadas
    const disambiguation = await callStructuredLLM(RESOLVE_CANDIDATE_PROMPT, [
      {
        role: "user",
        content: `Petición original: "${state.userPrompt}"\nCoincidencias encontradas: ${candidates
          .map((c) => `"${c}"`)
          .join(", ")}`
      }
    ]);
    entityValue = candidates.includes(disambiguation?.match) ? disambiguation.match : candidates[0];
  }

  return { labelField, entityValue, distanceKm };
}

async function executeBufferNode(state) {
  const { layer, view, labelField, entityValue, distanceKm } = state;

  // Ya sabemos que entityValue es un valor real (viene de searchCandidates),
  // así que aquí usamos coincidencia EXACTA en vez de LIKE: sin ambigüedad.
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

function routeAfterSelectLayer(state) {
  return state.resultText ? END : "loadSchema";
}

function routeAfterLoadSchema(state) {
  return state.resultText ? END : "buildEntityQuery";
}

function routeAfterBuildEntityQuery(state) {
  return state.resultText ? END : "executeBuffer";
}

const graph = new StateGraph(BufferEntityState)
  .addNode("selectLayer", selectLayerNode)
  .addNode("loadSchema", loadSchemaNode)
  .addNode("buildEntityQuery", buildEntityQueryNode)
  .addNode("executeBuffer", executeBufferNode)
  .addEdge(START, "selectLayer")
  .addConditionalEdges("selectLayer", routeAfterSelectLayer)
  .addConditionalEdges("loadSchema", routeAfterLoadSchema)
  .addConditionalEdges("buildEntityQuery", routeAfterBuildEntityQuery)
  .addEdge("executeBuffer", END);

const bufferEntityGraph = graph.compile();

export async function runBufferEntityGraph(view, userPrompt) {
  const availableLayers = view.map.layers.toArray().map((l) => ({ id: l.id, title: l.title }));

  if (availableLayers.length === 0) {
    return "No hay ninguna capa operativa cargada en el mapa todavía.";
  }

  const finalState = await bufferEntityGraph.invoke({ userPrompt, availableLayers, view });
  return finalState.resultText || "No he podido completar el área de influencia.";
}