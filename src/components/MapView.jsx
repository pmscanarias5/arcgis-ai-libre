import { useEffect, useRef } from "react";
import { useArcGISMap } from "../hooks/useArcGISMap.js";

export default function MapViewComponent({ onViewReady }) {
  const containerRef = useRef(null);
  const { view, status } = useArcGISMap(containerRef);

  // Notifica al componente padre en cuanto la vista esté lista (fuera del render)
  useEffect(() => {
    if (view && onViewReady) {
      onViewReady(view);
    }
  }, [view, onViewReady]);

  return (
    <div style={{ flex: 1, height: "100%", position: "relative" }}>
      {/* Este div es EXCLUSIVO de ArcGIS: nunca metas hijos React aquí dentro,
          ArcGIS reescribe su contenido y React perdería la pista del DOM. */}
      <div id="viewDiv" ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#809a9f", pointerEvents: "none" }}>
          Cargando mapa…
        </div>
      )}
      {status === "error" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#ff6b6b", pointerEvents: "none" }}>
          No se pudo cargar el WebMap.
        </div>
      )}
    </div>
  );
}