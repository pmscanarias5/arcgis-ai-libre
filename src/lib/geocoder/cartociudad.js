// Cliente JSONP para el geocodificador público de CartoCiudad (IGN).
// Se usa JSONP explícitamente (en vez de fetch()) porque el propio nombre
// del endpoint ("...Jsonp") y la experiencia de otros proyectos que
// consumen esta misma API confirman que está pensado para cargarse vía
// <script>, no vía fetch() con CORS.

const CANDIDATES_URL = "https://www.cartociudad.es/geocoder/api/geocoder/candidatesJsonp";
const FIND_URL = "https://www.cartociudad.es/geocoder/api/geocoder/findJsonp";

let jsonpCounter = 0;

function jsonpRequest(baseUrl, params, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `__cartociudad_jsonp_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement("script");
    let timeoutId;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
      clearTimeout(timeoutId);
    };

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Tiempo de espera agotado al consultar el geocodificador de CartoCiudad."));
    }, timeoutMs);

    const query = new URLSearchParams({ ...params, callback: callbackName }).toString();
    script.src = `${baseUrl}?${query}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("No se pudo cargar el geocodificador de CartoCiudad."));
    };

    document.head.appendChild(script);
  });
}

/**
 * Devuelve la lista de candidatos que ofrece CartoCiudad para un texto de
 * búsqueda libre (municipios, poblaciones, direcciones, topónimos...).
 * Vienen ya ordenados por relevancia según el propio servicio. Para algunos
 * tipos (toponimo, punto_recarga_electrica, ngbe) ya incluyen lat/lng
 * reales; para el resto (poblacion, Municipio, provincia, comunidad
 * autonoma, callejero, carretera) vienen a 0.0 hasta resolverlos con find().
 */
export async function getCandidates(query, { limit = 10, noProcess = "expendeduria" } = {}) {
  const data = await jsonpRequest(CANDIDATES_URL, {
    q: query,
    limit,
    no_process: noProcess,
    countrycode: "es",
    autocancel: true
  });
  return Array.isArray(data) ? data : [];
}

function hasResolvedCoords(candidate) {
  return typeof candidate.lat === "number" && typeof candidate.lng === "number" && (candidate.lat !== 0 || candidate.lng !== 0);
}

/**
 * Resuelve un candidato a sus coordenadas finales. Si el candidato ya trae
 * lat/lng reales (ver hasResolvedCoords), se devuelve directamente sin
 * gastar una segunda petición; si no, se llama a /find como marca el flujo
 * oficial de dos pasos del geocodificador.
 */
export async function findLocation(candidate, fallbackQuery) {
  if (hasResolvedCoords(candidate)) {
    return candidate;
  }

  return jsonpRequest(FIND_URL, {
    q: candidate.address || fallbackQuery,
    type: candidate.type || "",
    tip_via: candidate.tip_via ?? "null",
    id: candidate.id ?? "",
    portal: candidate.portalNumber ?? "null",
    extension: candidate.extension ?? "null"
  });
}