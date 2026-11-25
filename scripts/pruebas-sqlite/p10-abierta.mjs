// Renombrar, borrar y reemplazar con la base abierta: en Windows lo frenan los bloqueos; en el resto, no.
import fs from 'node:fs';
import path from 'node:path';

import { abrir, carpeta, caso, contar, hastaSalida, hijo, intento, uno } from './comun.mjs';

const d0 = carpeta('p10');
const crear = (nombre, journal) => {
  const archivo = path.join(carpeta(`p10/${nombre}`), 'x.db');
  const x = abrir(archivo, journal);
  x.exec('CREATE TABLE t(k PRIMARY KEY,v)');
  for (let i = 0; i < 50; i++) x.prepare('INSERT INTO t VALUES(?,?)').run(i, 'z'.repeat(500));
  return [archivo, x];
};
const op = (f) =>
  intento(() => {
    f();
    return 'se pudo';
  });
const insertar = (x) => op(() => x.prepare("INSERT INTO t VALUES(9999,'n')").run());
const acciones = {
  'renombrar la base': (f) => fs.renameSync(f, `${f}.viejo`),
  'borrar la base': (f) => fs.rmSync(f),
  'reemplazar por rename': (f) => fs.renameSync(`${f}.nuevo`, f),
  'sobrescribir en el lugar': (f) => fs.writeFileSync(f, fs.readFileSync(`${f}.nuevo`)),
};
let n = 0;
for (const journal of ['DELETE', 'WAL']) {
  for (const otro of [false, true]) {
    for (const [nombre, accion] of Object.entries(acciones)) {
      await caso(`10 ${nombre}, abierta por ${otro ? 'otro proceso' : 'el mismo'} ${journal}`, async (f) => {
        const [archivo, x] = crear(`a${n++}`, journal);
        x.close();
        fs.copyFileSync(archivo, `${archivo}.nuevo`);
        let vieja;
        let h;
        try {
          if (otro) {
            h = hijo('mantener', archivo);
            await hastaSalida(h);
          } else {
            vieja = abrir(archivo, null);
            uno(vieja, 'SELECT count(*) FROM t');
          }
          const r = op(() => accion(archivo));
          const insercion = vieja ? insertar(vieja) : 'no aplica';
          const sigue = fs.existsSync(archivo);
          f(
            `${r}; insertar en la conexión abierta: ${insercion}; existe: ${sigue}; conexión nueva: ${sigue ? contar(archivo) : '-'}`,
          );
        } finally {
          vieja?.close();
          h?.kill('SIGKILL');
          await h?.fin;
        }
      });
    }
  }
  await caso(`10 copiar solo el .db a mitad de transacción ${journal}`, (f) => {
    const [archivo, x] = crear(`b${journal}`, journal);
    x.exec('BEGIN IMMEDIATE; PRAGMA cache_size=5');
    for (let i = 50; i < 400; i++) x.prepare('INSERT INTO t VALUES(?,?)').run(i, 'y'.repeat(900));
    const copia = path.join(d0, `copia${journal}.db`);
    const r = op(() => fs.copyFileSync(archivo, copia));
    f(`copiar: ${r}; copia: ${fs.existsSync(copia) ? contar(copia) : '-'}`);
    const suf = journal === 'WAL' ? '-wal' : '-journal';
    const guardado = `${copia}.guardado`;
    f(
      op(() => fs.copyFileSync(archivo + suf, guardado)),
      undefined,
      `: copiar ${suf}`,
    );
    x.exec('ROLLBACK');
    x.close();
    if (!fs.existsSync(guardado)) return;
    const y = abrir(archivo, journal);
    for (let i = 1000; i < 1500; i++) y.prepare('INSERT INTO t VALUES(?,?)').run(i, 'q'.repeat(500));
    y.close();
    fs.copyFileSync(guardado, archivo + suf);
    f(`550 filas pasan a: ${contar(archivo)}`, undefined, `: ${suf} de otra generación`);
  });
  await caso(`10 borrar ya cerrada ${journal}`, (f) => {
    const [archivo, x] = crear(`c${journal}`, journal);
    x.close();
    const r = op(() => fs.rmSync(archivo));
    f(`${r}; queda: ${fs.readdirSync(path.dirname(archivo)).join(' ') || 'nada'}`, r === 'se pudo');
  });
}
