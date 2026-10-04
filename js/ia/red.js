// VOZI — Descargas de la IA más resistentes: reintenta fallos de red pasajeros y, si aun así falla,
// dice QUÉ archivo y de qué servidor no se pudo bajar (Safari solo dice «Load failed»).
export function instalarFetchResistente(global = self) {
  if (global.__voziFetch) return;
  const original = global.fetch.bind(global);
  global.__voziFetch = original;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    // Solo para los servidores de los modelos; el resto de la app no se toca
    if (!/huggingface\.co|hf\.co|githubusercontent\.com|xethub/i.test(url)) return original(input, init);
    let ultimo;
    for (let i = 0; i < 4; i++) {
      try { return await original(input, init); } catch (e) {
        ultimo = e;
        if (e && e.name === 'AbortError') throw e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    let host = url;
    try { const u = new URL(url); host = u.host + u.pathname.split('/').slice(0, 3).join('/'); } catch (e) { /* nada */ }
    const err = new Error(`No se pudo descargar ${host} (${ultimo && ultimo.message || 'error de red'})`);
    err.red = true;
    throw err;
  };
}
