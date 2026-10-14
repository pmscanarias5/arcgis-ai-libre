# arcgis-ai-chat

Piloto GIS: WebMap de ArcGIS + chatbot propio que usa un modelo de IA libre/gratuito
(en vez del AI Orchestrator nativo de ArcGIS) para interpretar peticiones en lenguaje
natural y ejecutar acciones sobre el mapa (cambiar basemap, hacer zoom, crear buffers).

## Estructura

```
arcgis-ai-chat/
├── index.html
├── vite.config.js
├── package.json
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── assets/
    │   └── ign-logo.png
    ├── hooks/
    │   ├── useArcGISMap.js           # inicializa WebMap + MapView
    │   └── useMapWidgets.js          # Zoom, LayerList, BasemapGallery, botón quitar selección
    ├── components/
    │   ├── MapView.jsx               # contenedor del mapa
    │   ├── ChatSidebar.jsx           # lógica del chat, maneja needsInput/resume
    │   ├── ChatMessage.jsx           # mensaje + botones de opciones
    │   ├── AttributeTablePanel.jsx   # FeatureTable en panel inferior fijo
    │   └── QueryResultsPanel.jsx     # panel flotante con resultados de consulta
    └── lib/
        ├── llmClient.js              # router de intenciones (getIntent)
        ├── formatNumber.js           # formato numérico es-ES (separador de miles)
        ├── llm/
        │   ├── callStructuredLLM.js  # llamada al LLM + validación Zod + reintento
        │   └── schemas.js            # esquemas Zod
        ├── geocoder/
        │   └── cartociudad.js        # cliente JSONP de CartoCiudad
        ├── mapActions/
        │   ├── index.js              # registro central de acciones
        │   ├── changeBasemap.js
        │   ├── basemapAliases.js
        │   ├── goToLocation.js
        │   ├── createBuffer.js
        │   ├── bufferEntity.js       # wrapper sobre langgraph/bufferEntityGraph.js
        │   ├── queryLayer.js         # wrapper sobre langgraph/queryLayerGraph.js
        │   ├── selectFeatures.js     # wrapper sobre langgraph/selectFeaturesGraph.js
        │   ├── clearSelection.js
        │   ├── printMap.js           # GPServer de impresión del IGN
        │   ├── explainCapabilities.js # explica qué puede hacer el asistente
        │   ├── none.js
        │   ├── selectionState.js     # selecciones activas por capa
        │   ├── selectionSync.js      # sincroniza selección chat <-> tabla
        │   ├── featureTableRegistry.js # tablas de atributos abiertas
        │   ├── lastBufferState.js    # último buffer generado, reutilizable
        │   └── mapActions.js
        └── langgraph/
            ├── sharedNodes.js        # nodos y utilidades comunes a los grafos
            ├── layerCatalog.js       # perfil de capas/campos (cacheado) para el LLM
            ├── queryLayerGraph.js
            ├── bufferEntityGraph.js
            └── selectFeaturesGraph.js
```

## Puesta en marcha


```bash
cd arcgis-ai-chat
npm install
npm run dev
```

Antes de `npm run dev`, crea un fichero `.env` en la raíz del proyecto (no se sube
a git) con esta plantilla y ajusta los valores a tu entorno:

```env
# LLM (cualquier endpoint compatible con chat/completions de OpenAI)
VITE_LLM_BASE_URL=http://localhost:11434/v1   # Ollama local por defecto
VITE_LLM_MODEL=llama3.1
VITE_LLM_API_KEY=                             # vacío si el proveedor no la pide (Ollama, LM Studio)

# ArcGIS
VITE_WEBMAP_ITEM_ID=<id-del-webmap>

# Servicios del IGN (opcionales: si se omiten se usan los públicos por defecto)
VITE_GEOCODER_URL=https://nco.ign.es/geocoder/rest/services/geocoder/GeocodeServer
VITE_PRINT_SERVICE_URL=https://serviciosgis.ign.es/servicios/rest/services/Signa/ServicioImpresionSignA/GPServer/Exportar%20mapa%20Web
```

> Las variables con prefijo `VITE_` acaban en el bundle del navegador: no pongas
> aquí claves de pago que no quieras exponer.

## Cómo funciona el flujo

1. El usuario escribe una petición en el chat.
2. `getIntent()` envía el prompt al modelo con un system prompt que fuerza una
   salida JSON con una `action` (`change_basemap`, `go_to_location`, `create_buffer`, `none`).
3. `ChatSidebar` despacha esa acción a `mapActions`, que opera directamente sobre
   la instancia `view` de ArcGIS Maps SDK.
4. La respuesta del mapActions se muestra como mensaje del bot.
