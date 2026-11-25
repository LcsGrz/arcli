import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as espera } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const original = process.emitWarning;
process.emitWarning = (w, ...a) => {
  if (a[0] === 'ExperimentalWarning' && String(w).startsWith('SQLite ')) return;
  Reflect.apply(original, process, [w, ...a]);
};
export const sqlite = await import('node:sqlite');
process.emitWarning = original;
export const DB = sqlite.Database ?? sqlite.DatabaseSync;
export const WIN = process.platform === 'win32';
export { espera };

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Cada prueba recibe su carpeta de correr.mjs, que la borra al final.
const RAIZ = process.env.PRUEBAS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'arcli-sqlite-'));
export const carpeta = (nombre) => {
  const d = path.join(RAIZ, nombre);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
export const abrir = (archivo, journal = 'DELETE', timeout = 5000, opciones = {}) => {
  const d = new DB(archivo, { timeout, ...opciones });
  if (journal) d.exec(`PRAGMA journal_mode=${journal}`);
  d.exec('PRAGMA synchronous=FULL');
  return d;
};
export const uno = (d, sql, ...p) => Object.values(d.prepare(sql).get(...p) ?? {})[0];
export const integridad = (d) => uno(d, 'PRAGMA integrity_check');
/** El valor, o el error en una línea. */
export const intento = (f) => {
  try {
    return f();
  } catch (e) {
    return `ERROR ${e.errcode ?? e.code ?? ''} ${e.errstr ?? ''}: ${e.message}`.slice(0, 160);
  }
};
export const falla = (x) => typeof x === 'string' && x.startsWith('ERROR');
/** Abre, usa y siempre cierra: en Windows una conexión sin cerrar impide borrar el archivo. */
export const con = (archivo, f, opciones = {}) => {
  const d = new DB(archivo, { timeout: 5000, ...opciones });
  try {
    return f(d);
  } finally {
    d.close();
  }
};
export const contar = (archivo, tabla = 't') =>
  intento(() => con(archivo, (c) => `${integridad(c)}, ${uno(c, `SELECT count(*) FROM ${tabla}`)} filas`));
export const hijo = (...args) => {
  const p = spawn(process.execPath, [path.join(AQUI, 'hijo.mjs'), ...args.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.out = '';
  p.err = '';
  p.stdout.on('data', (x) => (p.out += x));
  p.stderr.on('data', (x) => (p.err += x));
  p.fin = once(p, 'close');
  return p;
};
export const hastaSalida = async (p) => {
  const limite = Date.now() + 30000;
  while (!p.out && p.exitCode === null && p.signalCode === null && Date.now() < limite) await espera(2);
  // El proceso puede terminar antes de que llegue lo que escribió.
  if (!p.out && p.exitCode !== null) await p.fin;
  if (!p.out) throw new Error(`el hijo no arrancó: ${p.err.slice(-600)}`);
};
/** ok: true o false es un requisito; undefined es un dato. */
export const fila = (prueba, medido, ok) => console.log(`FILA\t${JSON.stringify({ prueba, medido, ok })}`);
/** Un fallo se ve en la tabla y no corta los casos que siguen. */
export const caso = async (prueba, f) => {
  try {
    await f((medido, ok, sub = '') => fila(prueba + sub, medido, ok));
  } catch (e) {
    fila(prueba, `NO SE PUDO PROBAR: ${e.stack?.split('\n').slice(0, 2).join(' ') ?? e}`, false);
  }
};
