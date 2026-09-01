import { clearAllSelectionHighlights, clearSelectionHighlight, getActiveSelections } from "./selectionState.js";
import { normalize } from "../langgraph/sharedNodes.js";

// Acción determinista, sin LLM ni grafo: no hay ninguna consulta que
// construir, solo decidir a qué selección(es) activa(s) se refiere el
// usuario, comparando el texto de su petición contra los títulos de las
// capas que realmente tienen una selección activa ahora mismo.
export async function clearSelection(view, { _userPrompt }) {
  const active = getActiveSelections();
  if (active.length === 0) {
    return "No hay ninguna selección activa que quitar.";
  }

  const promptNormalized = normalize(_userPrompt || "");
  const matched = active.filter((sel) => promptNormalized.includes(normalize(sel.layerTitle)));

  if (matched.length > 0) {
    matched.forEach((sel) => clearSelectionHighlight(sel.layerId));
    return `He quitado la selección de <b>${matched.map((s) => s.layerTitle).join(", ")}</b>.`;
  }

  // Si no menciona ninguna capa concreta (o menciona una que no coincide
  // con ninguna selección activa), se quitan todas las selecciones activas.
  const names = active.map((s) => s.layerTitle).join(", ");
  clearAllSelectionHighlights();
  return `He quitado la selección de <b>${names}</b>.`;
}