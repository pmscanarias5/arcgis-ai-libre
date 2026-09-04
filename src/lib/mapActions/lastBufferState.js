// Registro en memoria del último buffer (área de influencia) generado por
// buffer_entity, para que pueda usarse como geometría de referencia en una
// petición posterior de selección/consulta espacial ("los municipios que
// están dentro de ese buffer"), sin tener que volver a nombrar el lugar ni
// la distancia.
let lastBuffer = null; // { geometry, label } | null

export function setLastBuffer(geometry, label) {
  lastBuffer = { geometry, label };
}

export function getLastBuffer() {
  return lastBuffer;
}
