import { useEffect, useRef } from "react";
import FeatureTable from "@arcgis/core/widgets/FeatureTable";

export default function AttributeTablePanel({ view, layer, onClose }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!view || !layer || !containerRef.current) return;

    const table = new FeatureTable({
      view,
      layer,
      container: containerRef.current
    });

    return () => {
      table.destroy();
    };
  }, [view, layer]);

  if (!layer) return null;

  return (
    <div className="attribute-table-panel">
      <div className="attribute-table-header">
        <span>
          Tabla de atributos: <b>{layer.title}</b>
        </span>
        <button className="attribute-table-close" onClick={onClose} aria-label="Cerrar tabla de atributos">
          ✕
        </button>
      </div>
      <div className="attribute-table-container" ref={containerRef} />
    </div>
  );
}