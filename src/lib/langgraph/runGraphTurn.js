import { Command } from "@langchain/langgraph";

// Ejecuta un turno de un grafo compilado con checkpointer y adapta el
// resultado a un formato uniforme que consume la UI del chat:
//  - un string: la petición se ha completado, es la respuesta final.
//  - { needsInput, question, options, resume }: el grafo se ha pausado en
//    un interrupt() y necesita que el usuario elija una opción. resume(valor)
//    reanuda el grafo en el mismo thread_id exactamente donde se quedó, y
//    devuelve, recursivamente, otro string o otro needsInput si hiciera
//    falta una segunda aclaración.
export function runGraphTurn(compiledGraph, threadId, input) {
  const config = { configurable: { thread_id: threadId } };
  return compiledGraph.invoke(input, config).then((result) => adapt(compiledGraph, threadId, result));
}

function adapt(compiledGraph, threadId, result) {
  const pending = result.__interrupt__;
  if (pending && pending.length > 0) {
    const payload = pending[0].value;
    return {
      needsInput: true,
      question: payload.question,
      options: payload.options,
      resume: (choiceValue) => {
        const config = { configurable: { thread_id: threadId } };
        return compiledGraph
          .invoke(new Command({ resume: choiceValue }), config)
          .then((resumed) => adapt(compiledGraph, threadId, resumed));
      }
    };
  }

  return result.resultText || "No he podido completar la petición.";
}