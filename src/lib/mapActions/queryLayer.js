import { runQueryLayerGraph } from "../langgraph/queryLayerGraph.js";

// Esta acción ya no decide la capa/campo por heurística de texto: delega
// todo el proceso (elegir capa -> construir consulta -> ejecutar -> zoom)
// en el grafo de LangGraph definido en lib/langgraph/queryLayerGraph.js.
export async function queryLayer(view, { _userPrompt }) {
  return runQueryLayerGraph(view, _userPrompt || "");
}