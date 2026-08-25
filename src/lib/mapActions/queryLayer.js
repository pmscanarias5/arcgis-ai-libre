function normalize(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Busca entre las capas operativas cargadas la que mejor coincide con la
// palabra clave que ha dado el usuario (p.ej. "municipios").
function findLayer(view, hint) {
  const target = normalize(hint);
  if (!target) return null;
  const layers = view.map.layers.toArray();
  return (
    layers.find((l) => normalize(l.title).includes(target)) ||
    layers.find((l) => target.includes(normalize(l.title))) ||
    null
  );
}

// Busca entre los campos de la capa el que mejor coincide con la métrica
// pedida (p.ej. "poblacion" -> campo "POB_TOTAL" con alias "Población total").
function findBestField(layer, hint) {
  const target = normalize(hint);
  if (!target) return null;
  const fields = layer.fields || [];
  return (
    fields.find((f) => normalize(f.name).includes(target) || normalize(f.alias).includes(target)) ||
    null
  );
}

// Heurística para encontrar el campo "etiqueta" (nombre del municipio, etc.)
// cuando no se ha pedido uno explícitamente.
function findLabelField(layer) {
  if (layer.displayField) {
    const f = layer.fields?.find((f) => f.name === layer.displayField);
    if (f) return f;
  }
  const candidates = ["nombre", "name", "municipio", "denominacion", "etiqueta", "rotulo", "topónimo", "toponimo"];
  return (
    layer.fields?.find((f) =>
      candidates.some((c) => normalize(f.name).includes(c) || normalize(f.alias).includes(c))
    ) || layer.fields?.find((f) => f.type === "string") || null
  );
}

export async function queryLayer(view, { layer_hint, metric_hint, order, limit }) {
  const layer = findLayer(view, layer_hint);
  if (!layer) {
    return `No he encontrado ninguna capa cargada que coincida con "${layer_hint}".`;
  }

  await layer.load();

  if (typeof layer.queryFeatures !== "function") {
    return `La capa <b>${layer.title}</b> no admite consultas de atributos (no es una feature layer).`;
  }

  // Sin métrica: el usuario solo pregunta cuántos elementos hay en la capa
  if (!metric_hint) {
    const count = await layer.queryFeatureCount();
    return `La capa <b>${layer.title}</b> tiene <b>${count}</b> elemento(s).`;
  }

  const metricField = findBestField(layer, metric_hint);
  if (!metricField) {
    return `He encontrado la capa <b>${layer.title}</b>, pero no localizo ningún campo relacionado con "${metric_hint}".`;
  }

  const labelField = findLabelField(layer);
  const sortOrder = order === "asc" ? "ASC" : "DESC";
  const topN = Math.max(1, Math.min(limit || 1, 10));

  const query = layer.createQuery();
  query.where = `${metricField.name} IS NOT NULL`;
  query.orderByFields = [`${metricField.name} ${sortOrder}`];
  query.outFields = labelField ? [metricField.name, labelField.name] : [metricField.name];
  query.num = topN;
  query.returnGeometry = false;

  const result = await layer.queryFeatures(query);
  if (!result.features.length) {
    return `No he encontrado datos en <b>${layer.title}</b> para "${metric_hint}".`;
  }

  const items = result.features
    .map((f) => {
      const label = labelField ? f.attributes[labelField.name] : "—";
      const value = f.attributes[metricField.name];
      return `<li>${label}: <b>${value}</b></li>`;
    })
    .join("");

  const qualifier = sortOrder === "DESC" ? "mayor" : "menor";
  const heading =
    topN === 1
      ? `El elemento con ${qualifier} <b>${metricField.alias || metricField.name}</b> en <b>${layer.title}</b>`
      : `Los ${topN} elementos con ${qualifier} <b>${metricField.alias || metricField.name}</b> en <b>${layer.title}</b>`;

  return `${heading}:<ul>${items}</ul>`;
}