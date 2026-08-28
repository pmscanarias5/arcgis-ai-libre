import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { callStructuredLLM } from "../llm/callStructuredLLM.js";
import { resolveLayer, loadSchemaNode, findLabelField } from "./sharedNodes.js";

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
  resultText: Annotation()
});

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