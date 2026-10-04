// VOZI — Proceso en segundo plano para la IA del dispositivo (WebLLM).
import { WebWorkerMLCEngineHandler } from '../../vendor/webllm/web-llm.js';
import { instalarFetchResistente } from './red.js';

instalarFetchResistente(self);
const manejador = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => manejador.onmessage(msg);
