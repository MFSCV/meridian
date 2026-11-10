const source = new URL('./market-engine.wasm', import.meta.url);

async function load() {
  if (globalThis.process?.versions?.node && source.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return WebAssembly.instantiate(await readFile(source));
  }
  const response = await fetch(source, { cache: 'no-cache' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return WebAssembly.instantiate(await response.arrayBuffer());
}

let engine = null;
// Why the simulated data engine is unavailable, or null when it loaded.
export let engineError = null;

// Loads the engine. A failure is kept in engineError instead of stopping the workspace, and can be retried.
export async function loadEngine(loader = load) {
  try {
    const exports = (await loader()).instance.exports;
    if (typeof exports.generate !== 'function' || typeof exports.result_ptr !== 'function' || !exports.memory) throw new Error('Incompatible engine');
    engine = exports;
    engineError = null;
  } catch (problem) {
    engine = null;
    engineError = String(problem?.message ?? problem);
  }
  return !engineError;
}
await loadEngine();

export function simulatedBars(instrument, minutes, end) {
  if (!engine) return [];
  let seed = 101;
  for (const char of instrument.symbol) seed = Math.imul(seed, 31) + char.charCodeAt(0);
  const length = engine.generate(seed, instrument.base, minutes, end);
  const values = new Float64Array(engine.memory.buffer, engine.result_ptr(), length);
  const bars = [];
  for (let index = 0; index < length; index += 6) {
    bars.push({
      time: values[index], open: values[index + 1], high: values[index + 2], low: values[index + 3],
      close: values[index + 4], volume: values[index + 5]
    });
  }
  return bars;
}
