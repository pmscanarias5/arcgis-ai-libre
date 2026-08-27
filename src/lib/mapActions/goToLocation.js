import { getCandidates, findLocation } from "../geocoder/cartociudad.js";

// Nivel de zoom orientativo según el tipo de entidad que devuelve
// CartoCiudad. El API no es consistente con las mayúsculas del campo
// "type" (p.ej. "poblacion" vs "Municipio"), así que esta tabla se
// consulta siempre en minúsculas.
const ZOOM_BY_TYPE = {
  portal: 18,
  callejero: 16,
  carretera: 14,
  codpost: 13,
  poblacion: 13,
  toponimo: 15,
  punto_recarga_electrica: 17,
  ngbe: 14,
  municipio: 12,
  provincia: 9,
  "comunidad autonoma": 7
};

export async function goToLocation(view, { query }) {
  const searchText = (query || "").trim();
  if (!searchText) {
    return "No he entendido a qué lugar quieres ir.";
  }

  let candidates;
  try {
    candidates = await getCandidates(searchText);
  } catch (err) {
    console.error("Error al consultar el geocodificador (candidates):", err);
    return "No he podido conectar con el geocodificador para buscar ese lugar.";
  }

  if (!candidates.length) {
    return `No he encontrado ningún lugar que coincida con "${searchText}".`;
  }

  // CartoCiudad ya devuelve los candidatos ordenados por relevancia:
  // usamos el primero.
  const best = candidates[0];

  let resolved;
  try {
    resolved = await findLocation(best, searchText);
  } catch (err) {
    console.error("Error al consultar el geocodificador (find):", err);
    return "No he podido obtener las coordenadas de ese lugar.";
  }

  if (resolved?.lat == null || resolved?.lng == null || (resolved.lat === 0 && resolved.lng === 0)) {
    return `No he podido determinar las coordenadas de "${searchText}".`;
  }

  const zoom = ZOOM_BY_TYPE[(resolved.type || best.type || "").toLowerCase()] || 12;
  await view.goTo({ center: [resolved.lng, resolved.lat], zoom });

  const label = resolved.address || resolved.poblacion || resolved.muni || searchText;
  return `Aproximando la vista a <b>${label}</b>.`;
}