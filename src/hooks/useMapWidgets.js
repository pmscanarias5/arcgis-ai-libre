import { useEffect } from "react";
import Zoom from "@arcgis/core/widgets/Zoom";
import LayerList from "@arcgis/core/widgets/LayerList";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";
import Slider from "@arcgis/core/widgets/Slider";
import Search from "@arcgis/core/widgets/Search";
import LocatorSearchSource from "@arcgis/core/widgets/Search/LocatorSearchSource";
import { clearAllSelectionHighlights, onSelectionChange } from "../lib/mapActions/selectionState.js";
import ignLogo from "../assets/ign-logo.png";

const GEOCODER_URL =
  import.meta.env.VITE_GEOCODER_URL ||
  "https://nco.ign.es/geocoder/rest/services/geocoder/GeocodeServer";

export function useMapWidgets(view, onOpenTable) {
  useEffect(() => {
    if (!view) return;



    const removeSelectionChangeListener = onSelectionChange((hasSelection) => {
      clearSelectionButton.classList.toggle("has-selection", hasSelection);
    });

    const openTableButton = document.createElement("button");
    openTableButton.type = "button";
    openTableButton.className = "esri-widget esri-widget--button";
    openTableButton.title = "Tabla de atributos de la primera capa activa";
    openTableButton.innerHTML = '<span class="esri-icon esri-icon-table" aria-hidden="true"></span>';
    openTableButton.addEventListener("click", () => {
      const layers = view.map.layers.toArray();
      const targetLayer =
        layers.find((l) => l.visible && typeof l.queryFeatures === "function") ||
        layers.find((l) => typeof l.queryFeatures === "function");
      if (targetLayer && onOpenTable) {
        onOpenTable(targetLayer);
      }
    });
    view.ui.add(openTableButton, "bottom-left");

    // Banner con el logo del IGN a la izquierda del buscador, a modo de
    // "título" del geocodificador. El Search se monta en su propio div
    // (container) en vez de añadirlo directamente a view.ui, para poder
    // colocarlo junto al logo dentro del mismo bloque en horizontal.
    const geocoderBanner = document.createElement("div");
    geocoderBanner.className = "esri-widget geocoder-banner";

    const logoWrap = document.createElement("div");
    logoWrap.className = "geocoder-banner__logo-wrap";
    const logoImg = document.createElement("img");
    logoImg.src = ignLogo;
    logoImg.alt = "Instituto Geográfico Nacional";
    logoImg.className = "geocoder-banner__logo";
    logoWrap.appendChild(logoImg);
    geocoderBanner.appendChild(logoWrap);

    const brand = document.createElement("div");
    brand.className = "geocoder-banner__brand";
    brand.innerHTML =
      '<span class="geocoder-banner__brand-title">Sign<span class="geocoder-banner__brand-accent">A</span></span>' +
      '<span class="geocoder-banner__brand-subtitle">Sistema de Información Geográfica Nacional</span>';
    geocoderBanner.appendChild(brand);

    const searchContainer = document.createElement("div");
    searchContainer.className = "geocoder-banner__search";
    geocoderBanner.appendChild(searchContainer);

    view.ui.add(geocoderBanner, "top-left");

    const searchWidget = new Search({
      view,
      container: searchContainer,
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
    view.ui.add(basemapGalleryExpand, "bottom-right");
    
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

    return () => {
      triggerActionHandle.remove();
      view.ui.remove(zoomWidget);
      zoomWidget.destroy();
      removeSelectionChangeListener();
      view.ui.remove(clearSelectionButton);
      view.ui.remove(openTableButton);
      view.ui.remove(geocoderBanner);
      searchWidget.destroy();
      view.ui.remove(layerListExpand);
      layerListExpand.destroy();
      layerListWidget.destroy();
      view.ui.remove(basemapGalleryExpand);
      basemapGalleryExpand.destroy();
    };
  }, [view, onOpenTable]);
}