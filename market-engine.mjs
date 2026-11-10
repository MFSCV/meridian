const source = new URL('./market-engine.wasm', import.meta.url);

async function load() {
  if (globalThis.process?.versions?.node && source.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return WebAssembly.instantiate(await readFile(source));
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error('Could not load the Meridian market engine: HTTP ' + response.status);
  return WebAssembly.instantiate(await response.arrayBuffer());
}

const { instance: { exports: engine } } = await load();

export function simulatedBars(instrument, minutes, end) {
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
