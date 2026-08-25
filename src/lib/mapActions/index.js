import { changeBasemap } from "./changeBasemap.js";
import { goToLocation } from "./goToLocation.js";
import { createBuffer } from "./createBuffer.js";
import { queryLayer } from "./queryLayer.js";
import { none } from "./none.js";

// Registro de acciones disponibles. Cada una recibe (view, params) y
// devuelve el texto de respuesta para el chat. Para añadir una nueva
// capacidad (consultas a capas, geoprocesos, etc.): crea un fichero en
// esta carpeta y regístralo aquí.
export const mapActions = {
  change_basemap: changeBasemap,
  go_to_location: goToLocation,
  create_buffer: createBuffer,
  query_layer: queryLayer,
  none
};