import { BASEMAP_ALIASES } from "./basemapAliases.js";

export async function changeBasemap(view, { basemap }) {
  const id = BASEMAP_ALIASES[basemap?.toLowerCase()] || basemap;
  if (!id) return "No he reconocido ese mapa base.";
  view.map.basemap = id;
  return `He cambiado el mapa base a <b>${basemap}</b>.`;
}