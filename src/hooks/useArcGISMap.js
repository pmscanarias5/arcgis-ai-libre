import { useEffect, useRef, useState } from "react";
import WebMap from "@arcgis/core/WebMap";
import MapView from "@arcgis/core/views/MapView";

export function useArcGISMap(containerRef) {
  const viewRef = useRef(null);
  const [view, setView] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!containerRef.current) return;

    const webmap = new WebMap({
      portalItem: {
        id: import.meta.env.VITE_WEBMAP_ITEM_ID || "fef704c0f75441a5bc2a3c2b757530b8"
      }
    });

    const mapView = new MapView({
      container: containerRef.current,
      map: webmap,
      center: [-3.70379, 40.416775],
      zoom: 6,
      // Desactivamos los widgets por defecto (incluido el zoom automático)
      // para controlar explícitamente qué se añade y dónde, vía
      // useMapWidgets.js. Dejamos solo la atribución, obligatoria.
      ui: { components: ["attribution"] }
    });

    mapView.when(
      () => {
        viewRef.current = mapView;
        setView(mapView);
        setStatus("ready");
      },
      (err) => {
        if (err?.name === "AbortError") return;
        console.error("Error al cargar el WebMap:", err);
        setStatus("error");
      }
    );

    return () => {
      mapView.destroy();
      viewRef.current = null;
    };
  }, [containerRef]);

  return { view, status };
}