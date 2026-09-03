import { useEffect, useRef } from "react";
import { useArcGISMap } from "../hooks/useArcGISMap.js";
import { useMapWidgets } from "../hooks/useMapWidgets.js";

export default function MapViewComponent({ onViewReady, onOpenTable }) {
  const containerRef = useRef(null);
  const { view, status } = useArcGISMap(containerRef);

  useMapWidgets(view, onOpenTable);

  useEffect(() => {
    if (view && onViewReady) {
      onViewReady(view);
    }
  }, [view, onViewReady]);

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
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