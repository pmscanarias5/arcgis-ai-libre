import { useEffect, useState } from "react";

const PAGE_SIZE = 50;

// Panel flotante sobre el mapa que resume las entidades extraídas de una
// consulta o selección (todos sus atributos, no solo el campo consultado),
// inspirado en el widget "Consulta > Resultados" de ArcGIS Web AppBuilder,
// pero con el estilo oscuro de esta app. Al ser un overlay dentro de
// .map-column (no modal), se puede seguir escribiendo en el chat mientras
// está abierto.
export default function QueryResultsPanel({ results, onClose }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Cada resultado nuevo (otra consulta/selección) empieza mostrando de
  // nuevo solo la primera página, no donde se quedó el anterior.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [results]);

  if (!results) return null;

  const { records, layerTitle, totalCount } = results;
  const fetchedCount = records.length;
  const visibleRecords = records.slice(0, visibleCount);
  const isFetchTruncated = totalCount != null && totalCount > fetchedCount;
  const canShowMore = visibleCount < fetchedCount;

  return (
    <div className="query-results-panel">
      <div className="query-results-header">
        <span>Resultados{layerTitle ? `: ${layerTitle}` : ""}</span>
        <button className="query-results-close" onClick={onClose} aria-label="Cerrar resultados">
          ✕
        </button>
      </div>

      <div className="query-results-count">
        Entidades encontradas: <b>{totalCount ?? fetchedCount}</b>
        {isFetchTruncated ? ` (se han cargado las primeras ${fetchedCount})` : ""}
      </div>

      <div className="query-results-list">
        {visibleRecords.map((record, index) => (
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
          <button
            type="button"
            className="query-results-show-more"
            onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, fetchedCount))}
          >
            Mostrar más ({fetchedCount - visibleCount} restantes)
          </button>
        )}
      </div>
    </div>
  );
}
