// Corre todas las pruebas, cada una en su proceso, e imprime la tabla. Termina en 1 si algún requisito falla.
// Uso: node scripts/pruebas-sqlite/correr.mjs [p02 p10 …]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
// La ruta real: en Windows la temporal viene en formato 8.3 (RUNNER~1) y en macOS es un symlink.
const raiz = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'arcli-sqlite-')));
const filas = [];
const pedidas = process.argv.slice(2);
const pruebas = fs
  .readdirSync(aqui)
  .filter((x) => /^p\d\d-/.test(x) && (!pedidas.length || pedidas.some((z) => x.startsWith(z))))
  .sort();
for (const p of pruebas) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(aqui, p)], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, PRUEBAS_DIR: raiz },
  });
  for (const linea of (r.stdout ?? '').split(/\r?\n/))
    if (linea.startsWith('FILA\t')) filas.push(JSON.parse(linea.slice(5)));
    else if (linea) console.log(linea);
  const error = (r.stderr ?? '').trim();
  if (error) console.log(`stderr de ${p}: ${error.slice(0, 2000)}`);
  if (r.status !== 0)
    filas.push({
      prueba: p,
      medido: `salió con ${r.status ?? r.signal} ${r.error?.message ?? ''} ${error.slice(-300)}`,
      ok: false,
    });
  console.log(`${p}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
let limpieza = 'ok';
try {
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (e) {
  limpieza = `${e.code} ${e.message}`;
}
filas.push({ prueba: 'borrar la carpeta temporal al final', medido: limpieza, ok: limpieza === 'ok' });

const titulo = `${process.platform} ${process.arch} · Node ${process.version} · SQLite ${process.versions.sqlite} · ${os.release()}`;
const texto = (x) =>
  (typeof x === 'string' ? x : (JSON.stringify(x) ?? 'nada'))
    .replaceAll(raiz, '<tmp>')
    .replaceAll('|', '/')
    .replace(/\s+/g, ' ');
const estado = (ok) => (ok === undefined ? 'dato' : ok ? 'ok' : 'FALLA');
const tabla = filas.map((f) => `| ${estado(f.ok)} | ${f.prueba} | ${texto(f.medido)} |`).join('\n');
const fallas = filas.filter((f) => f.ok === false).length;
const salida = `## ${titulo}\n\n| Estado | Prueba | Medido |\n|---|---|---|\n${tabla}\n\n${fallas} requisitos fallan de ${filas.filter((f) => f.ok !== undefined).length}.\n`;
console.log(salida);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, salida);
process.exitCode = fallas ? 1 : 0;
