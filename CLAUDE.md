# arcgis-ai-chat

Piloto GIS: WebMap de ArcGIS (JS SDK) + chatbot propio que usa un LLM libre/local
(vía un endpoint compatible con la API chat/completions de OpenAI, p.ej. Ollama)
para interpretar peticiones en lenguaje natural y ejecutar acciones sobre el mapa.
Sustituye al AI Orchestrator nativo de ArcGIS (`arcgis-assistant`/`arcgis-assistant-agent`),
que NO se usa en este proyecto.

## Stack

- React 18 + Vite
- `@arcgis/core` (ArcGIS Maps SDK for JS), instalado vía npm, no vía `<script>` CDN
- `@langchain/langgraph` + `@langchain/core` + `zod` para las acciones complejas
- `vite-plugin-node-polyfills` (necesario para que LangGraph no rompa el build de Vite)
- Geocodificador: CartoCiudad (IGN), consumido vía JSONP real (no `fetch`, ver más abajo)
- Servicio de impresión propio: GPServer de IGN (Signa)

## Cómo arrancar

```bash
npm install
cp .env.example .env   # ajustar VITE_LLM_BASE_URL, VITE_LLM_MODEL, etc.
npm run dev
```

El LLM tiene que estar accesible en `VITE_LLM_BASE_URL` (Ollama local, LM Studio, Groq...).
Sin eso, el router de intenciones y todos los grafos fallan.

## Arquitectura general

Usuario escribe en el chat
│
▼
getIntent() (llmClient.js) → 1 llamada LLM, clasifica la intención
│
▼
mapActions[intent.action](view, params) → ejecuta la acción


Cada acción de mapa vive en `src/lib/mapActions/<nombre>.js` y se registra en
`src/lib/mapActions/index.js`. Hay dos tipos:

1. **Deterministas** (sin LLM, o con un único paso simple): `changeBasemap`,
   `goToLocation`, `createBuffer`, `printMap`, `clearSelection`, `none`.
2. **Complejas, delegadas en un grafo de LangGraph**: `queryLayer` → `queryLayerGraph.js`,
   `bufferEntity` → `bufferEntityGraph.js`, `selectFeatures` → `selectFeaturesGraph.js`.
   Estas tres comparten lógica en `src/lib/langgraph/sharedNodes.js`.

Una mapAction devuelve **o bien un string** (respuesta final para el chat), **o bien**
`{ needsInput: true, question, options, resume }` cuando hace falta que el usuario
elija algo (ver "Selección de capa ambigua" más abajo). `ChatSidebar.jsx` sabe
interpretar ambos casos y renderiza botones con `options` si aplica.

## Estructura de ficheros relevante

src/
├── App.jsx # layout: mapa + chat + panel de tabla inferior
├── components/
│ ├── MapView.jsx # contenedor del mapa, widgets, notifica view al padre
│ ├── ChatSidebar.jsx # lógica de conversación, maneja needsInput/resume
│ ├── ChatMessage.jsx # renderiza mensaje + botones de opciones si hay
│ └── AttributeTablePanel.jsx # FeatureTable en panel inferior fijo
├── hooks/
│ ├── useArcGISMap.js # crea WebMap + MapView
│ └── useMapWidgets.js # Zoom, LayerList+opacidad+tabla, BasemapGallery, botón quitar selección
├── lib/
│ ├── llmClient.js # router de intenciones (getIntent), SYSTEM_PROMPT central
│ ├── llm/
│ │ ├── callStructuredLLM.js # fetch al LLM + parseo JSON + validación Zod + reintento de reparación
│ │ └── schemas.js # todos los esquemas Zod (IntentSchema, BuildQuerySchema, etc.)
│ ├── geocoder/
│ │ └── cartociudad.js # cliente JSONP real (candidates + find)
│ ├── mapActions/
│ │ ├── index.js # registro central de todas las acciones
│ │ ├── changeBasemap.js
│ │ ├── basemapAliases.js
│ │ ├── goToLocation.js # usa geocoder/cartociudad.js, NO pide coords al LLM
│ │ ├── createBuffer.js # buffer sobre el centro de la vista
│ │ ├── printMap.js # llama al GPServer de impresión
│ │ ├── queryLayer.js # wrapper fino sobre langgraph/queryLayerGraph.js
│ │ ├── bufferEntity.js # wrapper fino sobre langgraph/bufferEntityGraph.js
│ │ ├── selectFeatures.js # wrapper fino sobre langgraph/selectFeaturesGraph.js
│ │ ├── clearSelection.js # sin LLM, quita resaltados activos
│ │ ├── selectionState.js # Map en memoria: layerId -> {handle, layerTitle}
│ │ └── none.js
│ └── langgraph/
│ ├── sharedNodes.js # resolveLayer, loadSchemaNode, resolveFilters, findBestField,
│ │ # findLabelField, searchDistinctValues, resolveAmbiguousValue
│ ├── queryLayerGraph.js # loadSchema -> buildQuery -> executeQuery
│ ├── bufferEntityGraph.js # loadSchema -> buildEntityQuery -> executeBuffer
│ └── selectFeaturesGraph.js # loadSchema -> buildSelection -> executeSelection


## El router de intenciones (`llmClient.js`)

Una única llamada LLM (`getIntent`) clasifica cada mensaje en una de estas acciones:
`change_basemap`, `go_to_location`, `print_map`, `query_layer`, `buffer_entity`,
`select_features`, `clear_selection`, `none`. El `SYSTEM_PROMPT` contiene reglas
explícitas para distinguir los pares más confundibles:

- `go_to_location` (ir a un lugar YA conocido por nombre) vs `query_layer`
  (pregunta cuya respuesta depende de datos: "más poblado", "cuántos", etc.)
- `create_buffer` (centro de la vista) vs `buffer_entity` (entidad concreta de una capa)
- `select_features` (marcar/resaltar sin pedir ranking) vs `query_layer` (responder con datos)

**Importante**: `go_to_location` NUNCA debe llevar coordenadas inventadas por el LLM —
solo extrae un `query` de texto libre; las coordenadas reales las resuelve
`goToLocation.js` llamando al geocodificador de verdad.

## Validación con Zod (`llm/schemas.js` + `llm/callStructuredLLM.js`)

Todas las llamadas LLM pasan por `callStructuredLLM(systemPrompt, messages, schema)`.
Si `schema` (Zod) no valida la respuesta, se reintenta UNA vez con un prompt de
reparación antes de devolver `null`. Esquemas actuales: `IntentSchema`,
`SelectLayerSchema`, `BuildQuerySchema`, `SelectFeaturesSchema`, `ExtractSearchTextSchema`,
`ResolveCandidateSchema`.

`BuildQuerySchema` y `SelectFeaturesSchema` usan `filters: FilterSchema[]` (máx. 3),
NO un único filtro — se generalizó así porque un solo filtro no bastaba para peticiones
tipo "municipios de Madrid con más de 5000 habitantes" (dos condiciones a la vez).
`resolveFilters` (en `sharedNodes.js`) las combina siempre con `AND`; condiciones que
no encajan con ningún campo real se descartan en silencio en vez de romper la consulta.

## Patrón de los 3 grafos de LangGraph

`queryLayerGraph`, `bufferEntityGraph` y `selectFeaturesGraph` siguen todos la misma forma:

1. **`resolveLayer(userPrompt, availableLayers)`** (función normal, FUERA del `StateGraph`,
   en `sharedNodes.js`) — decide qué capa usar. Si el LLM no tiene confianza, devuelve
   `{ needsSelection: true, options }` en vez de fallar.
2. Si `needsSelection`, la función `runXxxGraph` devuelve `{ needsInput, question, options, resume }`
   directamente SIN construir/ejecutar el `StateGraph` todavía. `resume(chosenLayerId)`
   invoca el grafo con `selectedLayerId` ya fijado.
3. Si no hace falta preguntar, se invoca el `StateGraph` directamente con
   `{ userPrompt, view, selectedLayerId }`.
4. Dentro del grafo: `loadSchemaNode` (carga campos reales de la capa) → nodo de
   construcción específico (`buildQueryNode`/`buildEntityQueryNode`/`buildSelectionNode`,
   con su propia llamada LLM y su propio prompt) → nodo de ejecución
   (`executeQueryNode`/`executeBufferNode`/`executeSelectionNode`, sin LLM, contra el
   FeatureServer real vía `layer.queryFeatures()`).

### ⚠️ NO usar `interrupt()`/`Command`/`MemorySaver` de LangGraph en este proyecto

Se probó `interrupt()` para pausar el grafo en la selección de capa ambigua y
reanudarlo con `Command({ resume })`. **Colgaba la página sin ningún error en consola.**
Sospecha (no confirmada al 100%, no se pudo depurar más a fondo): `interrupt()`
depende de `AsyncLocalStorage` (`async_hooks` de Node), que en el navegador solo
existe como stub sin funcionalidad real vía `vite-plugin-node-polyfills`, así que el
seguimiento interno del grafo se rompe en silencio. Se sustituyó por el patrón manual
descrito arriba (`resolveLayer` + `needsInput`/`resume` construido a mano), que si
funciona. **Si en el futuro se reintenta usar `interrupt()`, verificar primero en un
entorno de pruebas aislado antes de tocar el flujo de producción.**

## Desambiguación contra datos reales (nunca confiar en lo que "adivina" el LLM)

Patrón usado en varios sitios: el LLM nunca decide un valor final por su cuenta si ese
valor tiene que existir en los datos reales. En su lugar:

1. El LLM extrae un texto/pista aproximada (`search_text`, `filter_value_hint`, etc.)
2. Se consulta el FeatureServer real (`searchDistinctValues` en `sharedNodes.js`,
   `LIKE` case-insensitive) para obtener candidatos que existen de verdad.
3. Si hay 1 candidato, se usa directo. Si hay varios, una 2ª llamada LLM
   (`resolveAmbiguousValue`) elige entre ellos — nunca puede inventar uno nuevo,
   se valida que la elección esté en la lista de candidatos.
4. La consulta final usa `=` exacto contra el valor ya confirmado (nunca `LIKE` en
   la consulta final para evitar ambigüedad/lentitud).

**Excepción importante**: para campos NUMÉRICOS (tipo `small-integer`, `integer`,
`single`, `double`, `long`, `big-integer`), NUNCA se usa `LIKE` — se construye una
comparación directa (`campo > 1000`) con el operador que extrae el LLM
(`filter_operator`: `=`, `>`, `>=`, `<`, `<=`, `!=`). Bug real ya corregido: al
principio se intentó `LIKE '%>1000%'` sobre un campo numérico y nunca devolvía
resultados — `findBestField`/tipo de campo se usa ahora para decidir la rama.

## Geocodificador CartoCiudad (`geocoder/cartociudad.js`)

**Usa JSONP real (inyección de `<script>`), NO `fetch()`.** Confirmado que el servicio
está pensado para JSONP (nombre del endpoint, y otros proyectos que lo consumen tuvieron
que usar librerías tipo `fetch-jsonp` por problemas de CORS con `fetch` normal).

Flujo de dos pasos:
1. `getCandidates(query)` → `candidatesJsonp` → lista de candidatos ordenados por
   relevancia. Se usa el primero (`candidates[0]`) sin desambiguación LLM adicional
   (a diferencia del patrón de arriba; aquí se confía en el ranking propio del servicio).
2. `findLocation(candidate, fallbackQuery)` → si el candidato YA trae `lat`/`lng`
   reales (pasa con `toponimo`, `punto_recarga_electrica`, `ngbe`), se devuelve
   directo sin 2ª petición. Si no (pasa con `poblacion`, `Municipio`, `provincia`,
   `comunidad autonoma`, `callejero`, `carretera`, que vienen a `0.0`), se llama a
   `findJsonp` para resolverlas de verdad.

**Ojo con el campo `type` del candidato**: la API NO es consistente en mayúsculas
(`"poblacion"` en minúscula pero `"Municipio"` con M mayúscula). `ZOOM_BY_TYPE` en
`goToLocation.js` se consulta siempre normalizando a minúsculas, PERO el `type` se
reenvía tal cual (sin normalizar) a `find()` por si el servicio es case-sensitive ahí
— no verificado a fondo, vigilar si algún tipo con mayúscula falla en `find`.

`candidate.address` es el campo correcto para el parámetro `q` de `find()` (confirmado
con respuesta real del servicio, ya no es una suposición).

## Servicio de impresión (`printMap.js`)

Usa `@arcgis/core/rest/print.js` + `PrintTemplate`/`PrintParameters` contra un GPServer
propio del IGN (`VITE_PRINT_SERVICE_URL`). Los valores `format`/`layout` son literales
en **español** (`"Formato de documento portátil (PDF)"`, `"A4 Horizontal"`) porque así
funcionaban en un proyecto anterior del usuario con este mismo servicio — son distintos
de los códigos estándar del Print Task de Esri (`"PDF"`, `"a4-landscape"`). No cambiar
sin confirmar contra el servicio real.

## Selección de entidades (`selectFeatures` / `clearSelection`)

- `selectFeaturesGraph.js` resalta con `layerView.highlight(objectIds)` (efecto visual
  nativo de ArcGIS), guarda el "handle" en `selectionState.js` (Map en memoria:
  `layerId -> { handle, layerTitle }`).
- Una nueva selección en la MISMA capa reemplaza el resaltado anterior automáticamente.
  Selecciones en capas distintas conviven (no hay límite de "una selección global").
- `clearSelection.js` (acción determinista, sin LLM/grafo): si el usuario menciona el
  título de una capa con selección activa, quita solo esa; si no, quita todas.
- El botón "quitar selección" en el mapa (`useMapWidgets.js`, icono papelera junto a
  Zoom) quita SIEMPRE todas las selecciones activas, sin preguntar.

## Widgets del mapa (`useMapWidgets.js`)

Todos son widgets nativos del SDK, no custom: `Zoom`, `LayerList` (con
`listItemCreatedFunction` para añadir un `Slider` de opacidad por capa y una acción
"Ver tabla de atributos" — solo en capas con `queryFeatures`, no en group layers ni
tile layers), `BasemapGallery`, ambos `LayerList` y `BasemapGallery` envueltos en
`Expand` (colapsables). El `MapView` se crea con `ui: { components: ["attribution"] }`
para desactivar los widgets automáticos por defecto y controlar todo explícitamente.

La tabla de atributos (`FeatureTable`) se abre en un panel FIJO en la parte inferior
de TODA la pantalla (no solo del mapa) — requirió reestructurar `App.jsx` con un
wrapper `.app-shell` (flex-column) que contiene `.app-container` (mapa+chat, flex-row)
y `AttributeTablePanel` como hermano debajo. Solo una tabla abierta a la vez.

## CORS / arquitectura general

Todo corre 100% en el navegador, sin backend propio: el LLM, el geocodificador y el
servicio de impresión se llaman directamente desde el cliente. Esto es una decisión
consciente (más simple para el piloto), no un descuido — si se necesita ocultar
API keys reales de un proveedor LLM de pago, habría que reconsiderar esto y mover
`callStructuredLLM` detrás de un proxy backend.

## Pendientes / limitaciones conocidas (no implementadas a propósito)

- Filtros combinados con `AND` únicamente (máx. 3), no hay soporte para `OR`
  ("municipios de Madrid o de Toledo").
- `goToLocation` no desambigua con LLM entre varios candidatos del geocodificador,
  siempre usa el primero (el ranking propio de CartoCiudad).
- Sin persistencia entre sesiones del navegador (recargar página pierde selecciones
  activas e historial de chat — `historyRef` en `ChatSidebar.jsx` es solo en memoria).
- No hay backend propio: cualquier API key en `.env` con prefijo `VITE_` queda expuesta
  en el bundle del navegador.

## Convenciones de estilo del proyecto

- Todo el texto de cara al usuario (mensajes del chat, prompts del sistema) en español.
- Comentarios de código en español, explicando el "por qué" de decisiones no obvias,
  no el "qué" (el código ya lo dice).
- Los ficheros de `mapActions/*.js` que delegan en un grafo son wrappers finos de
  1 función — la lógica real vive siempre en `langgraph/*.js`.