import { runBufferEntityGraph } from "../langgraph/bufferEntityGraph.js";

// Igual que query_layer, esta acción delega en un grafo de LangGraph: elige
// la capa real -> carga su esquema -> extrae la entidad y la distancia ->
// busca la entidad en el FeatureServer -> genera el buffer geodésico real.
export async function bufferEntity(view, { _userPrompt, _history }) {
  return runBufferEntityGraph(view, _userPrompt || "", _history || []);
}