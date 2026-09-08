// Formato numérico consistente para toda la app: separador de miles "."
// (locale es-ES), tanto en las tarjetas del panel de resultados como en los
// mensajes de respuesta del chat. Los valores que no son número (nombres,
// provincias...) se devuelven tal cual, sin tocar.
const numberFormatter = new Intl.NumberFormat("es-ES");

export function formatNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return value;
  return numberFormatter.format(value);
}
