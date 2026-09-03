import { useEffect, useRef, useState } from "react";
import FeatureTable from "@arcgis/core/widgets/FeatureTable";
import {
  setSelectionHighlight,
  replaceSelectionHighlight,
  clearSelectionHighlight,
  getSelectionObjectIds
} from "../lib/mapActions/selectionState.js";
import { registerFeatureTable, unregisterFeatureTable } from "../lib/mapActions/featureTableRegistry.js";

const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const RESIZE_MARGIN = 100; // hueco mínimo que se deja siempre al mapa

export default function AttributeTablePanel({ view, layer, onClose }) {
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const dragStateRef = useRef(null);
  const [totalCount, setTotalCount] = useState(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);

  const handleResizeMove = (event) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const delta = dragState.startY - event.clientY; // arrastrar hacia arriba agranda la tabla
    setHeight(Math.min(dragState.maxHeight, Math.max(MIN_HEIGHT, dragState.startHeight + delta)));
  };

  const handleResizeEnd = () => {
    dragStateRef.current = null;
    setIsDragging(false);
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
  };

  const handleResizeStart = (event) => {
    event.preventDefault();
    const parentHeight = panelRef.current?.parentElement?.clientHeight ?? window.innerHeight;
    dragStateRef.current = {
      startY: event.clientY,
      startHeight: panelRef.current?.offsetHeight ?? height,
      maxHeight: Math.max(MIN_HEIGHT, parentHeight - RESIZE_MARGIN)
    };
    setIsDragging(true);
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, []);

  useEffect(() => {
    if (!view || !layer || !containerRef.current) return;

    setTotalCount(null);
    setSelectedCount(0);

    const table = new FeatureTable({
      view,
      layer,
      container: containerRef.current
    });

    // Se registra la tabla para que una selección hecha por chat mientras
    // está abierta se aplique a través de ella (ver selectionSync.js), y
    // para poder devolverle el control del resaltado a la vista al cerrar.
    registerFeatureTable(layer.id, table);

    layer
      .queryFeatureCount()
      .then(setTotalCount)
      .catch(() => setTotalCount(null));

    // Si ya había una selección activa en esta capa (hecha antes por chat),
    // se traslada a la tabla al abrirla para que aparezca ya marcada.
    const existingObjectIds = getSelectionObjectIds(layer.id);
    if (existingObjectIds?.length) {
      table.highlightIds.addMany(existingObjectIds);
    }

    // La selección de filas en la tabla resalta entidades en el mapa con su
    // propio mecanismo (table.highlightIds), independiente del que usan las
    // selecciones por chat. La reflejamos aquí en el mismo registro
    // compartido (selectionState) para que el botón de borrar selección del
    // mapa se ilumine, pueda quitarla, y una selección hecha por chat sepa
    // que la tabla la posee.
    let hasActiveSelection = false;
    const highlightChangeHandle = table.highlightIds.on("change", () => {
      const objectIds = [...table.highlightIds];
      setSelectedCount(objectIds.length);

      const hasSelection = objectIds.length > 0;
      if (hasSelection && !hasActiveSelection) {
        hasActiveSelection = true;
        setSelectionHighlight(layer.id, layer.title, { remove: () => table.highlightIds.removeAll() }, objectIds);
      } else if (hasSelection) {
        // Los objectIds han cambiado (filas añadidas/quitadas de la
        // selección) sin pasar de 0 a >0: se actualizan sin invocar el
        // handle anterior (es el mismo, el de esta propia tabla).
        replaceSelectionHighlight(layer.id, layer.title, { remove: () => table.highlightIds.removeAll() }, objectIds);
      } else if (hasActiveSelection) {
        hasActiveSelection = false;
        clearSelectionHighlight(layer.id);
      }
    });

    return () => {
      highlightChangeHandle.remove();
      unregisterFeatureTable(layer.id, table);

      if (hasActiveSelection) {
        // Se traspasa la selección a un resaltado directo de la vista para
        // que no desaparezca del mapa al cerrar la tabla de atributos.
        const objectIds = [...table.highlightIds];
        view.whenLayerView(layer).then((layerView) => {
          const handle = layerView.highlight(objectIds);
          replaceSelectionHighlight(layer.id, layer.title, handle, objectIds);
        });
      }

      table.destroy();
    };
  }, [view, layer]);

  if (!layer) return null;

  return (
    <div className="attribute-table-panel" ref={panelRef} style={{ height }}>
      <div
        className={`attribute-table-resize-handle${isDragging ? " is-dragging" : ""}`}
        onMouseDown={handleResizeStart}
        title="Arrastrar para redimensionar"
      />
      <div className="attribute-table-header">
        <span>
          Tabla de atributos: <b>{layer.title}</b>
        </span>
        <button className="attribute-table-close" onClick={onClose} aria-label="Cerrar tabla de atributos">
          ✕
        </button>
      </div>
      <div className="attribute-table-container" ref={containerRef} key={layer.id} />
      <div className="attribute-table-footer">
        <span className="attribute-table-footer-count">
          {totalCount != null ? `${totalCount} entidad(es)` : "Cargando…"}
          {selectedCount > 0 ? ` · ${selectedCount} seleccionada(s)` : ""}
        </span>
      </div>
    </div>
  );
}