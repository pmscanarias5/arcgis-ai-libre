export async function goToLocation(view, { longitude, latitude, zoom, label }) {
  if (longitude == null || latitude == null) {
    return "No he podido determinar las coordenadas de esa ubicación.";
  }
  await view.goTo({ center: [longitude, latitude], zoom: zoom || 12 });
  return `Aproximando la vista a <b>${label || "la ubicación indicada"}</b>.`;
}