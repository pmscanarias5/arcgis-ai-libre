import { BASEMAP_ALIASES } from "./basemapAliases.js";

// Acción determinista, sin LLM: el router (llmClient.js) ya decidió el
// sub-tema (params.topic) en su única llamada al modelo, aquí solo se
// construye el texto de respuesta correspondiente.

const CAPABILITIES_TEXT =
  "Esto es lo que puedo hacer en el mapa:<br>" +
  "<ul>" +
  "<li>Cambiar el mapa base (satélite, topográfico, oscuro, calles).</li>" +
  "<li>Ir a un lugar por su nombre, centrando y haciendo zoom sobre él.</li>" +
  "<li>Consultar datos de las capas cargadas: máximos, mínimos, conteos o rankings.</li>" +
  "<li>Hacer un buffer (área de influencia) alrededor de una entidad concreta de una capa.</li>" +
  "<li>Seleccionar y resaltar en el mapa las entidades que cumplan una condición.</li>" +
  "<li>Imprimir o exportar a PDF la vista actual del mapa.</li>" +
  "</ul>";

// Nombre en español que se le muestra al usuario por cada tipo de geometría
// real de ArcGIS; group layers, tile layers, etc. no tienen un tipo
// reconocible aquí y se listan solo con su título.
const GEOMETRY_TYPE_LABELS = {
  point: "puntos",
  multipoint: "puntos",
  polyline: "líneas",
  polygon: "polígonos"
};

function explainLayers(view) {
  const layers = view.map.layers.toArray();
  if (layers.length === 0) {
    return "No hay ninguna capa cargada en el mapa todavía.";
  }

  const items = layers
    .map((layer) => {
      const geometryLabel = GEOMETRY_TYPE_LABELS[layer.geometryType];
      return geometryLabel ? `<li>${layer.title} (${geometryLabel})</li>` : `<li>${layer.title}</li>`;
    })
    .join("");

  return `Estas son las capas cargadas en el mapa:<ul>${items}</ul>`;
}

function explainBasemaps() {
  // Se construye a partir de BASEMAP_ALIASES (varios alias apuntan al mismo
  // mapa base real) en vez de escribir la lista a mano, para quedar
  // sincronizado si se añaden alias nuevos ahí. Por cada mapa base real se
  // queda con el alias con tilde (más natural para mostrar) si existe.
  const labelById = {};
  for (const [alias, id] of Object.entries(BASEMAP_ALIASES)) {
    const hasAccent = /[áéíóúñ]/i.test(alias);
    if (!labelById[id] || hasAccent) labelById[id] = alias;
  }

  const items = Object.values(labelById)
    .map((name) => `<li>${name.charAt(0).toUpperCase()}${name.slice(1)}</li>`)
    .join("");
  return `Estos son los mapas base que puedes elegir:<ul>${items}</ul>`;
}

export async function explainCapabilities(view, { topic } = {}) {
  if (topic === "layers") return explainLayers(view);
  if (topic === "basemaps") return explainBasemaps();
  return CAPABILITIES_TEXT;
}
