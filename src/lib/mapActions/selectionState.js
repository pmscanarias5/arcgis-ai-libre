// Guarda el "handle" del resaltado de selección activo por capa (junto con
// su título, para mensajes y para desambiguar peticiones del chat, y los
// objectIds seleccionados), y permite limpiar una capa concreta o todas a la
// vez. Es el registro único que comparten tanto las selecciones hechas por
// chat (selectFeaturesGraph, a través de layerView.highlight) como las
// hechas a mano en la tabla de atributos (a través de table.highlightIds),
// para que ambas se entiendan mutuamente: cualquiera de las dos puede leer,
// sustituir o limpiar la selección activa de una capa sin saber quién la
// creó.
const highlightHandles = new Map(); // layerId -> { handle, layerTitle, objectIds }
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

export function setSelectionHighlight(layerId, layerTitle, handle, objectIds = null) {
  clearSelectionHighlight(layerId);
  highlightHandles.set(layerId, { handle, layerTitle, objectIds });
  notifySelectionChange();
}

// Igual que setSelectionHighlight, pero sin invocar el handle anterior antes
// de sustituirlo. Se usa únicamente para "traspasar" una misma selección
// entre mecanismos de resaltado (p.ej. de table.highlightIds a un highlight
// directo de layerView al cerrar la tabla de atributos), donde el handle
// anterior ya no es seguro de invocar (el widget que lo creó se está
// destruyendo) o ya se limpia solo.
export function replaceSelectionHighlight(layerId, layerTitle, handle, objectIds = null) {
  highlightHandles.set(layerId, { handle, layerTitle, objectIds });
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

// Devuelve los objectIds actualmente seleccionados en una capa (o null si no
// hay selección activa, o no se conocen). La usa la tabla de atributos para
// mostrar ya marcadas las filas de una selección hecha antes por chat.
export function getSelectionObjectIds(layerId) {
  return highlightHandles.get(layerId)?.objectIds ?? null;
}