import Graphic from "@arcgis/core/Graphic";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";

export async function createBuffer(view, { distance_km }) {
  const km = distance_km || 10;
  const centerPoint = view.center;
  const bufferGeom = geometryEngine.geodesicBuffer(centerPoint, km, "kilometers");

  const graphic = new Graphic({
    geometry: bufferGeom,
    symbol: {
      type: "simple-fill",
      color: [0, 230, 195, 0.3],
      outline: { color: [0, 230, 195, 1], width: 2 }
    }
  });

  view.graphics.removeAll();
  view.graphics.add(graphic);
  return `Se ha generado un área de influencia de <b>${km} km</b> sobre el centro de la vista actual.`;
}