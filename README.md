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
├── .env.example
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── hooks/
    │   └── useArcGISMap.js      # inicializa WebMap + MapView
    ├── components/
    │   ├── MapView.jsx          # contenedor del mapa
    │   ├── ChatSidebar.jsx      # lógica del chat y orquestación
    │   └── ChatMessage.jsx
    └── lib/
        ├── llmClient.js         # llamada al modelo (endpoint OpenAI-compatible)
        └── mapActions.js        # acciones ejecutables sobre `view`
```

## Puesta en marcha

Este scaffold ya está generado (equivalente a `npm create vite@latest arcgis-ai-chat -- --template react`
más las dependencias de ArcGIS). Para arrancarlo en tu máquina:

```bash
cd arcgis-ai-chat
npm install
cp .env.example .env   # y ajusta las variables
npm run dev
```

## Eligiendo el modelo de IA "libre"

`llmClient.js` habla con cualquier endpoint compatible con la API
`chat/completions` de OpenAI, así que puedes apuntarlo a:

- **Ollama en local** (100% gratuito y offline): instala Ollama, ejecuta
  `ollama pull llama3.1` y `ollama serve`. `VITE_LLM_BASE_URL=http://localhost:11434/v1`.
- **LM Studio en local**: arranca el servidor local y usa
  `VITE_LLM_BASE_URL=http://localhost:1234/v1`.
- **Groq (free tier, en la nube, muy rápido)**: `VITE_LLM_BASE_URL=https://api.groq.com/openai/v1`
  con tu `VITE_LLM_API_KEY` y un modelo como `llama-3.1-70b-versatile`.

No hay dependencia de `openai` npm ni de LangChain en este punto de partida — es un
`fetch` directo para mantenerlo simple. Si luego quieres reutilizar el patrón que ya
tienes en `buffer-assistant.js` (extracción estructurada con Zod + LangGraph), puedes
sustituir `llmClient.js` por esa misma lógica sin tocar `mapActions.js` ni `ChatSidebar.jsx`.

## Cómo funciona el flujo

1. El usuario escribe una petición en el chat.
2. `getIntent()` envía el prompt al modelo con un system prompt que fuerza una
   salida JSON con una `action` (`change_basemap`, `go_to_location`, `create_buffer`, `none`).
3. `ChatSidebar` despacha esa acción a `mapActions`, que opera directamente sobre
   la instancia `view` de ArcGIS Maps SDK.
4. La respuesta del mapActions se muestra como mensaje del bot.

## Próximos pasos sugeridos

- Añadir más acciones a `mapActions.js` (consultas a capas WMS/FeatureServer, geoprocesos).
- Sustituir el parsing JSON manual por *tool calling* nativo si el proveedor lo soporta.
- Persistir el WebMap `item-id` y credenciales de portal vía variables de entorno.
- Si despliegas en IIS, revisar `base` en `vite.config.js` (ya viste este problema en el proyecto anterior).
