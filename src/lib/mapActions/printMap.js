import * as printService from "@arcgis/core/rest/print.js";
import PrintTemplate from "@arcgis/core/rest/support/PrintTemplate.js";
import PrintParameters from "@arcgis/core/rest/support/PrintParameters.js";

const PRINT_SERVICE_URL =
  import.meta.env.VITE_PRINT_SERVICE_URL ||
  "https://serviciosgis.ign.es/servicios/rest/services/Signa/ServicioImpresionSignA/GPServer/Exportar%20mapa%20Web";

export async function printMap(view, { title } = {}) {
  if (!view) {
    return "Error: no se pudo acceder a la vista del mapa.";
  }

  try {
    const template = new PrintTemplate({
      format: "Formato de documento portátil (PDF)",
      Output_File: "mapa_impreso.pdf",
      layout: "A4 Horizontal",
      layoutOptions: {
        titleText: title || "Impresión generada por Asistente IA"
      },
      exportOptions: {
        width: view.width,
        height: view.height,
        dpi: 96
      }
    });

    const params = new PrintParameters({ view, template });
    const result = await printService.execute(PRINT_SERVICE_URL, params);

    return `El PDF se ha generado correctamente. Puedes descargarlo aquí: <a href="${result.url}" target="_blank" rel="noopener">${result.url}</a>`;
  } catch (error) {
    console.error("Error al imprimir el mapa:", error);
    return "Hubo un error al intentar generar la impresión del mapa.";
  }
}