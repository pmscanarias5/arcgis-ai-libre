import { getFeatureTable } from "./featureTableRegistry.js";
import { setSelectionHighlight } from "./selectionState.js";

/**
 * Aplica una selección de entidades sobre una capa, sea cual sea el origen
 * (chat o tabla de atributos), de forma que ambas superficies queden
 * sincronizadas y se entiendan mutuamente:
 *
 * - Si la tabla de atributos de esa capa está abierta, se resalta a través
 *   de su propio mecanismo (table.highlightIds), que además marca como
 *   seleccionadas las filas correspondientes en la tabla. Su propio listener
 *   de cambios (ver AttributeTablePanel) se encarga de registrar la
 *   selección en selectionState.
 * - Si no hay tabla abierta, se resalta directamente sobre la vista del
 *   mapa (layerView.highlight) y se registra aquí mismo.
 */
export async function applySelection(view, layer, objectIds) {
  const table = getFeatureTable(layer.id);

  if (table) {
    table.highlightIds.removeAll();
    table.highlightIds.addMany(objectIds);
    return;
  }

  const layerView = await view.whenLayerView(layer);
  const highlightHandle = layerView.highlight(objectIds);
  setSelectionHighlight(layer.id, layer.title, highlightHandle, objectIds);
}
