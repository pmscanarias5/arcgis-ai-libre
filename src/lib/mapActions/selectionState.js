// Guarda el "handle" del resaltado de selección activo por capa (junto con
// su título, para mensajes y para desambiguar peticiones del chat), y
// permite limpiar una capa concreta o todas a la vez.
const highlightHandles = new Map(); // layerId -> { handle, layerTitle }
const changeListeners = new Set();

function notifySelectionChange() {
  for (const listener of changeListeners) {
    listener(highlightHandles.size > 0);
  }
}

export function onSelectionChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function setSelectionHighlight(layerId, layerTitle, handle) {
  clearSelectionHighlight(layerId);
  highlightHandles.set(layerId, { handle, layerTitle });
  notifySelectionChange();
}

export function clearSelectionHighlight(layerId) {
  const existing = highlightHandles.get(layerId);
  if (existing) {
    existing.handle.remove();
    highlightHandles.delete(layerId);
    notifySelectionChange();
  }
}

export function clearAllSelectionHighlights() {
  for (const layerId of [...highlightHandles.keys()]) {
    clearSelectionHighlight(layerId);
  }
}

export function getActiveSelections() {
  return [...highlightHandles.entries()].map(([layerId, { layerTitle }]) => ({ layerId, layerTitle }));
}