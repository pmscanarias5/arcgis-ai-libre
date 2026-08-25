import { useEffect, useRef, useState } from "react";
import WebMap from "@arcgis/core/WebMap";
import MapView from "@arcgis/core/views/MapView";

/**
 * Inicializa el WebMap + MapView y expone la instancia de `view`
 * una vez que está lista, para que el chatbot pueda operar sobre ella.
 */
export function useArcGISMap(containerRef) {
  const viewRef = useRef(null);
  const [view, setView] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

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
      center: [-3.70379, 40.416775], // Madrid
      zoom: 6
    });

    mapView.when(
      () => {
        viewRef.current = mapView;
        setView(mapView);
        setStatus("ready");
      },
      (err) => {
        // En desarrollo, StrictMode monta el efecto, lo desmonta y lo vuelve a
        // montar: la primera instancia se destruye a mitad de carga y ArcGIS
        // reporta un AbortError. Es esperado y no indica un fallo real.
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