// Registro de las tablas de atributos (FeatureTable) actualmente abiertas,
// por layer.id. Permite que una selección hecha por chat, si la tabla de esa
// capa está abierta, se aplique a través de ella (table.highlightIds) en vez
// de un resaltado aparte, para que ambas superficies vean la misma selección.
const openTables = new Map(); // layerId -> FeatureTable

export function registerFeatureTable(layerId, table) {
  openTables.set(layerId, table);
}

export function unregisterFeatureTable(layerId, table) {
  if (openTables.get(layerId) === table) {
    openTables.delete(layerId);
  }
}

export function getFeatureTable(layerId) {
  return openTables.get(layerId) || null;
}
