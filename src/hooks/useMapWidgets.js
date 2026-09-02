import { useEffect } from "react";
import Zoom from "@arcgis/core/widgets/Zoom";
import LayerList from "@arcgis/core/widgets/LayerList";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";
import Slider from "@arcgis/core/widgets/Slider";
import Search from "@arcgis/core/widgets/Search";
import LocatorSearchSource from "@arcgis/core/widgets/Search/LocatorSearchSource";
import { clearAllSelectionHighlights, onSelectionChange } from "../lib/mapActions/selectionState.js";

const GEOCODER_URL =
  import.meta.env.VITE_GEOCODER_URL ||
  "https://nco.ign.es/geocoder/rest/services/geocoder/GeocodeServer";

export function useMapWidgets(view, onOpenTable) {
  useEffect(() => {
    if (!view) return;

    const zoomWidget = new Zoom({ view });
    view.ui.add(zoomWidget, "top-left");

    // Botón plano con las clases del propio SDK (esri-widget /
    // esri-widget--button): hereda el estilo del tema oscuro sin CSS
    // adicional, igual que Zoom o el resto de widgets nativos.
    const clearSelectionButton = document.createElement("button");
    clearSelectionButton.type = "button";
    clearSelectionButton.className = "esri-widget esri-widget--button clear-selection-button";
    clearSelectionButton.title = "Quitar selección";
    clearSelectionButton.innerHTML = '<span class="esri-icon esri-icon-trash" aria-hidden="true"></span>';
    clearSelectionButton.addEventListener("click", () => {
      clearAllSelectionHighlights();
    });
    view.ui.add(clearSelectionButton, "top-left");

    const removeSelectionChangeListener = onSelectionChange((hasSelection) => {
      clearSelectionButton.classList.toggle("has-selection", hasSelection);
    });

    const searchWidget = new Search({
      view,
      includeDefaultSources: false,
      sources: [
        new LocatorSearchSource({
          url: GEOCODER_URL,
          singleLineFieldName: "SingleLine",
          name: "Geocoder IGN",
          placeholder: "Buscar dirección o lugar..."
        })
      ]
    });
    view.ui.add(searchWidget, "top-right");

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
      removeSelectionChangeListener();
      view.ui.remove(clearSelectionButton);
      view.ui.remove(searchWidget);
      searchWidget.destroy();
      view.ui.remove(layerListExpand);
      layerListExpand.destroy();
      layerListWidget.destroy();
      view.ui.remove(basemapGalleryExpand);
      basemapGalleryExpand.destroy();
    };
  }, [view, onOpenTable]);
}