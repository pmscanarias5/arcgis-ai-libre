import { z } from "zod";

/**
 * Esquema para resolver qué valor de una lista de candidatos es el correcto.
 */
export const ResolveCandidateSchema = z.object({
  match: z.string()
});

/**
 * Esquema para seleccionar una capa del mapa.
 */
export const SelectLayerSchema = z.object({
  layer_id: z.string().nullable()
});

/**
 * Esquema para construir una consulta de capa (query_layer).
 */
export const BuildQuerySchema = z.object({
  metric_field_hint: z.string().nullable(),
  order: z.enum(["asc", "desc"]),
  limit: z.number().min(1).max(10),
  filter_field_hint: z.string().nullable(),
  filter_value_hint: z.string().nullable(),
  filter_operator: z.enum(["=", ">", ">=", "<", "<=", "!="]).nullable()
});

/**
 * Esquema para extraer texto de búsqueda y distancia de una petición.
 */
export const ExtractSearchTextSchema = z.object({
  search_text: z.string(),
  distance_km: z.number().nullable()
});

/**
 * Esquema para el orquestador de intenciones (llmClient).
 * Decide qué acción ejecutar sobre el mapa.
 */
export const IntentSchema = z.object({
  action: z.enum(["change_basemap", "go_to_location", "print_map", "query_layer", "buffer_entity", "none"]),
  params: z.object({
    basemap: z.string().optional(),
    query: z.string().optional(),
    title: z.string().nullable().optional(),
    reply: z.string().optional()
  })
});
