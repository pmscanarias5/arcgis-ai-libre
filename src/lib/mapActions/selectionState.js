// Guarda el "handle" del resaltado de selección activo por capa, para
// poder limpiarlo antes de aplicar una nueva selección sobre esa misma
// capa (si no, los resaltados anteriores se quedarían acumulados).
const highlightHandles = new Map();

export function setSelectionHighlight(layerId, handle) {
  clearSelectionHighlight(layerId);
  highlightHandles.set(layerId, handle);
}

export function clearSelectionHighlight(layerId) {
  const existing = highlightHandles.get(layerId);
  if (existing) {
    existing.remove();
    highlightHandles.delete(layerId);
  }
}