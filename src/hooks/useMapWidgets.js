import { useEffect } from "react";
import Zoom from "@arcgis/core/widgets/Zoom";
import LayerList from "@arcgis/core/widgets/LayerList";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";
import Slider from "@arcgis/core/widgets/Slider";

/**
 * Añade los widgets básicos del SDK de ArcGIS a la vista:
 * - Zoom: botones de acercar/alejar.
 * - LayerList: panel de capas con checkbox de visibilidad, slider de
 *   transparencia por capa y acción para abrir la tabla de atributos.
 *   Colapsable, envuelto en un Expand (mismo patrón que BasemapGallery).
 * - BasemapGallery: selector visual de mapas base, dentro de un Expand.
 *
 * @param {import("@arcgis/core/views/MapView").default} view
 * @param {(layer: __esri.Layer) => void} onOpenTable
 */
export function useMapWidgets(view, onOpenTable) {
  useEffect(() => {
    if (!view) return;

    const zoomWidget = new Zoom({ view });
    view.ui.add(zoomWidget, "top-left");

    const layerListWidget = new LayerList({
      view,
      listItemCreatedFunction: (event) => {
        const { item } = event;
        if (item.layer.type === "group") return;

        const slider = new Slider({
          min: 0,
          max: 1,
          precision: 2,
          values: [item.layer.opacity ?? 1],
          visibleElements: { labels: true, rangeLabels: true }
        });
        slider.on("thumb-drag", (evt) => {
          item.layer.opacity = evt.value;
        });

        item.panel = {
          content: slider,
          className: "esri-icon-sliders-horizontal",
          title: "Transparencia de la capa"
        };

        if (typeof item.layer.queryFeatures === "function") {
          item.actionsSections = [
            [
              {
                title: "Ver tabla de atributos",
                className: "esri-icon-table",
                id: "open-table"
              }
            ]
          ];
        }
      }
    });

    const layerListExpand = new Expand({
      view,
      content: layerListWidget,
      expandIcon: "layers",
      expandTooltip: "Capas del mapa"
    });
    view.ui.add(layerListExpand, "top-right");

    const triggerActionHandle = layerListWidget.on("trigger-action", (event) => {
      if (event.action.id === "open-table" && onOpenTable) {
        onOpenTable(event.item.layer);
      }
    });

    const basemapGalleryExpand = new Expand({
      view,
      content: new BasemapGallery({ view }),
      expandIcon: "basemap",
      expandTooltip: "Cambiar mapa base"
    });
    view.ui.add(basemapGalleryExpand, "top-right");

    return () => {
      triggerActionHandle.remove();
      view.ui.remove(zoomWidget);
      zoomWidget.destroy();
      view.ui.remove(layerListExpand);
      layerListExpand.destroy();
      layerListWidget.destroy();
      view.ui.remove(basemapGalleryExpand);
      basemapGalleryExpand.destroy();
    };
  }, [view, onOpenTable]);
}