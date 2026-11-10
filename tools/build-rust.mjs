import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const result = spawnSync(process.env.CARGO || 'cargo', [
  'build', '--manifest-path', 'rust/Cargo.toml', '--target', 'wasm32-unknown-unknown',
  '--target-dir', 'rust/target', '--release', '--locked'
], { cwd: fileURLToPath(root), stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await copyFile(new URL('rust/target/wasm32-unknown-unknown/release/meridian_market.wasm', root),
  new URL('market-engine.wasm', root));
