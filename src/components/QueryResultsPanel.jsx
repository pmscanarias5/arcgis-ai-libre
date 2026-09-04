import { useEffect, useState } from "react";

// Panel flotante sobre el mapa que resume las entidades extraídas de una
// consulta (todos sus atributos, no solo el campo consultado), inspirado en
// el widget "Consulta > Resultados" de ArcGIS Web AppBuilder, pero con el
// estilo oscuro de esta app. Al ser un overlay dentro de .map-column (no
// modal), se puede seguir escribiendo en el chat mientras está abierto.
//
// Solo se trae del servidor la primera página de entidades (rápido); el
// resto no se pide hasta que el usuario pulsa "Mostrar más", que dispara
// results.loadMoreRecords(offset) — una consulta nueva y acotada, no vuelve
// a traer nada que ya se hubiera cargado.
export default function QueryResultsPanel({ results, onClose }) {
  const [records, setRecords] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Cada resultado nuevo (otra consulta) empieza de cero con su propia
  // primera página, no acumulando la del resultado anterior.
  useEffect(() => {
    setRecords(results?.records || []);
    setLoadingMore(false);
  }, [results]);

  if (!results) return null;

  const { layerTitle, totalCount, loadMoreRecords } = results;
  const canShowMore = typeof loadMoreRecords === "function" && (totalCount == null || records.length < totalCount);

  async function handleShowMore() {
    setLoadingMore(true);
    try {
      const more = await loadMoreRecords(records.length);
      setRecords((prev) => [...prev, ...more]);
    } catch (err) {
      console.error("Error al cargar más resultados:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="query-results-panel">
      <div className="query-results-header">
        <span>Resultados{layerTitle ? `: ${layerTitle}` : ""}</span>
        <button className="query-results-close" onClick={onClose} aria-label="Cerrar resultados">
          ✕
        </button>
      </div>

      <div className="query-results-count">
        Entidades encontradas: <b>{totalCount ?? records.length}</b>
      </div>

      <div className="query-results-list">
        {records.map((record, index) => (
          <div className="query-results-record" key={index}>
            {record.title != null && <div className="query-results-record-title">{String(record.title)}</div>}
            <dl className="query-results-record-fields">
              {record.fields.map((field) => (
                <div className="query-results-field-row" key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value != null && field.value !== "" ? String(field.value) : "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {canShowMore && (
          <button type="button" className="query-results-show-more" onClick={handleShowMore} disabled={loadingMore}>
            {loadingMore ? "Cargando…" : `Mostrar más (${totalCount - records.length} restantes)`}
          </button>
        )}
      </div>
    </div>
  );
}
