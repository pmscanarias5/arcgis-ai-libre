// Perfil de una capa: para cada campo relevante, describe su naturaleza
// REAL (valores de dominio codificados, rango numérico real, o una muestra
// de valores de texto reales) en vez de solo su nombre/alias. Esto le da al
// LLM contexto de los datos, no solo del esquema, para:
// - elegir mejor a qué capa se refiere una petición (reemplaza los ejemplos
//   escritos a mano por capa, como se hacía antes para "ríos")
// - elegir mejor a qué campo se refiere, y entender qué valores son válidos
//   (p.ej. un dominio "TIPO_VIA": CALLE/AVENIDA/PLAZA)
//
// Los resultados se cachean en memoria por layer.id: calcular un perfil
// implica consultas extra al FeatureServer, así que solo se paga una vez
// por capa por sesión de navegador.

const profileCache = new Map(); // layer.id -> Promise<Profile>

const IGNORED_FIELD_PATTERNS = [/^objectid$/i, /^shape/i, /^fid$/i, /^globalid$/i];
const MAX_TEXT_FIELDS_SAMPLED = 6;
const MAX_SAMPLE_VALUES = 8;
const NUMERIC_TYPES = ["small-integer", "integer", "single", "double", "long", "big-integer"];

function isIgnorableField(field) {
  return IGNORED_FIELD_PATTERNS.some((re) => re.test(field.name));
}

async function fetchNumericRanges(layer, numericFields) {
  if (numericFields.length === 0) return {};

  const query = layer.createQuery();
  query.outStatistics = numericFields.flatMap((f) => [
    { statisticType: "min", onStatisticField: f.name, outStatisticFieldName: `${f.name}_min` },
    { statisticType: "max", onStatisticField: f.name, outStatisticFieldName: `${f.name}_max` }
  ]);

  try {
    const result = await layer.queryFeatures(query);
    const stats = result.features[0]?.attributes || {};
    const ranges = {};
    for (const f of numericFields) {
      const min = stats[`${f.name}_min`];
      const max = stats[`${f.name}_max`];
      if (min != null && max != null) ranges[f.name] = { min, max };
    }
    return ranges;
  } catch (err) {
    console.warn(`No se pudieron calcular estadísticas numéricas de ${layer.title}:`, err);
    return {};
  }
}

async function fetchDistinctSamples(layer, field) {
  const query = layer.createQuery();
  query.where = "1=1";
  query.outFields = [field.name];
  query.returnDistinctValues = true;
  query.returnGeometry = false;
  query.num = MAX_SAMPLE_VALUES;

  try {
    const result = await layer.queryFeatures(query);
    return result.features.map((f) => f.attributes[field.name]).filter((v) => v != null);
  } catch (err) {
    console.warn(`No se pudieron muestrear valores de ${field.name} en ${layer.title}:`, err);
    return [];
  }
}

async function buildProfile(layer) {
  await layer.load();

  if (typeof layer.queryFeatures !== "function") {
    return { title: layer.title, geometryType: layer.geometryType, fields: [] };
  }

  const fields = (layer.fields || []).filter((f) => !isIgnorableField(f));

  const numericFields = fields.filter((f) => NUMERIC_TYPES.includes(f.type) && !f.domain);
  const ranges = await fetchNumericRanges(layer, numericFields);

  const textFields = fields.filter((f) => f.type === "string" && !f.domain);
  const sampledTextFields = textFields.slice(0, MAX_TEXT_FIELDS_SAMPLED);
  const samples = {};
  for (const field of sampledTextFields) {
    samples[field.name] = await fetchDistinctSamples(layer, field);
  }

  const fieldProfiles = fields.map((f) => {
    if (f.domain?.type === "coded-value") {
      return {
        name: f.name,
        alias: f.alias,
        type: f.type,
        kind: "domain",
        values: f.domain.codedValues.map((cv) => cv.name)
      };
    }
    if (NUMERIC_TYPES.includes(f.type) && ranges[f.name]) {
      return { name: f.name, alias: f.alias, type: f.type, kind: "range", ...ranges[f.name] };
    }
    if (samples[f.name]?.length) {
      return {
        name: f.name,
        alias: f.alias,
        type: f.type,
        kind: "sample",
        values: samples[f.name],
        truncated: samples[f.name].length >= MAX_SAMPLE_VALUES
      };
    }
    return { name: f.name, alias: f.alias, type: f.type, kind: "unknown" };
  });

  return { title: layer.title, geometryType: layer.geometryType, fields: fieldProfiles };
}

/**
 * Devuelve el perfil de una capa (calculándolo la primera vez, reutilizando
 * después). Incluye, por campo: dominio codificado, rango numérico real, o
 * una muestra de valores de texto reales.
 */
export function getLayerProfile(layer) {
  if (!profileCache.has(layer.id)) {
    profileCache.set(layer.id, buildProfile(layer));
  }
  return profileCache.get(layer.id);
}

/** Formatea el perfil de una capa como texto legible para un prompt. */
export function describeFieldsForPrompt(profile) {
  return profile.fields
    .map((f) => {
      const label = f.alias && f.alias !== f.name ? `${f.name} (alias: "${f.alias}")` : f.name;
      if (f.kind === "domain") return `- ${label}: valores posibles: ${f.values.join(", ")}`;
      if (f.kind === "range") return `- ${label}: numérico, rango real de ${f.min} a ${f.max}`;
      if (f.kind === "sample") {
        const suffix = f.truncated ? " (hay más valores, esto es solo una muestra)" : "";
        return `- ${label}: texto, ejemplos reales: ${f.values.join(", ")}${suffix}`;
      }
      return `- ${label} (tipo: ${f.type})`;
    })
    .join("\n");
}

/**
 * Resumen compacto de varias capas (para el paso de elegir capa): título,
 * tipo de geometría y unos pocos ejemplos reales de su campo más
 * identificativo, en vez de listas de ejemplos escritas a mano por capa.
 */
export async function describeLayersForPrompt(layers) {
  const summaries = await Promise.all(
    layers.map(async (layer) => {
      try {
        const profile = await getLayerProfile(layer);
        const sampleField = profile.fields.find((f) => f.kind === "sample" || f.kind === "domain");
        const examples = sampleField ? ` — ejemplos: ${sampleField.values.slice(0, 6).join(", ")}` : "";
        return `- id: "${layer.id}", título: "${layer.title}", geometría: ${profile.geometryType}${examples}`;
      } catch (err) {
        console.warn(`No se pudo perfilar la capa ${layer.title}:`, err);
        return `- id: "${layer.id}", título: "${layer.title}"`;
      }
    })
  );
  return summaries.join("\n");
}
