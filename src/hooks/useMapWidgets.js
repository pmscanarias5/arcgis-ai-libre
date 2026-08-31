import { useEffect } from "react";
import Zoom from "@arcgis/core/widgets/Zoom";
import LayerList from "@arcgis/core/widgets/LayerList";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";

/**
 * Añade los widgets básicos del SDK de ArcGIS a la vista:
 * - Zoom: botones de acercar/alejar.
 * - LayerList: panel de capas con checkbox de encendido/apagado de
 *   visibilidad incluido de serie.
 * - BasemapGallery: selector visual de mapas base, envuelto en un Expand
 *   (patrón estándar de Esri para este widget: botón que despliega el
 *   panel de miniaturas en vez de ocupar espacio fijo). Cambia la misma
 *   propiedad webmap.basemap que ya usa la acción change_basemap del chat,
 *   así que ambos caminos son intercambiables sin conflicto.
 */
export function useMapWidgets(view) {
  useEffect(() => {
    if (!view) return;

    const zoomWidget = new Zoom({ view });
    view.ui.add(zoomWidget, "top-left");

    const layerListWidget = new LayerList({ view });
    view.ui.add(layerListWidget, "top-right");

    const basemapGalleryExpand = new Expand({
      view,
      content: new BasemapGallery({ view }),
      expandIcon: "basemap",
      expandTooltip: "Cambiar mapa base"
    });
    view.ui.add(basemapGalleryExpand, "top-right");

    return () => {
      view.ui.remove(zoomWidget);
      zoomWidget.destroy();
      view.ui.remove(layerListWidget);
      layerListWidget.destroy();
      view.ui.remove(basemapGalleryExpand);
      basemapGalleryExpand.destroy();
    };
  }, [view]);
}