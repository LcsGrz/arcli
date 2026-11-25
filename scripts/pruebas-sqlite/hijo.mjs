// Los procesos que las pruebas lanzan, y a veces matan. Uso: hijo.mjs <modo> <archivo> ...
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { abrir, uno } from './comun.mjs';

const [modo, archivo, ...a] = process.argv.slice(2);
// Síncrono en todos los sistemas: process.stdout sobre un pipe no lo es en todos.
const decir = (x) => fs.writeSync(1, `${typeof x === 'string' ? x : JSON.stringify(x)}\n`);
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const modos = {
  escritor() {
    const [journal, timeout, n, id, tx] = a;
    const r = { w: 0, locked: 0, otros: {}, maxMs: 0 };
    const t0 = performance.now();
    const d = abrir(archivo, journal === '-' ? null : journal, Number(timeout));
    for (let i = 0; i < Number(n); i++) {
      const t = performance.now();
      try {
        d.exec(tx === 'deferred' ? 'BEGIN' : 'BEGIN IMMEDIATE');
        const v = tx === 'deferred' ? uno(d, 'SELECT count(*) FROM t') : i;
        d.prepare('INSERT INTO t VALUES(?,?)').run(`${id}-${i}`, v);
        d.exec('COMMIT');
        r.w++;
      } catch (e) {
        if ((e.errcode & 0xff) === 5) r.locked++;
        else r.otros[`${e.errcode} ${e.message}`] = 1;
        try {
          d.exec('ROLLBACK');
        } catch {
          // BEGIN mismo falló: no hay nada que revertir.
        }
      }
      r.maxMs = Math.max(r.maxMs, Math.round(performance.now() - t));
    }
    r.totalMs = Math.round(performance.now() - t0);
    decir(r);
  },
  // Transacción que nunca termina: la matan por la mitad.
  victima() {
    const d = abrir(archivo, a[0]);
    d.exec('PRAGMA cache_size=10; BEGIN IMMEDIATE');
    const s = d.prepare('INSERT INTO t VALUES(?,?)');
    for (let i = 0; i < 300; i++) s.run(`v${i}`, 'x'.repeat(2000));
    decir('medio');
    for (let i = 300; i < 200000; i++) s.run(`v${i}`, 'y'.repeat(2000));
  },
  // Confirma de a una y avisa cada confirmación: ninguna avisada se puede perder.
  confirmador() {
    const d = abrir(archivo, a[0]);
    const desde = uno(d, 'SELECT count(*) FROM t');
    for (let i = desde; i < desde + 100000; i++) {
      d.exec('BEGIN IMMEDIATE');
      d.prepare('INSERT INTO t VALUES(?,?)').run(`c${i}`, 'x'.repeat(500));
      d.exec('COMMIT');
      decir(String(i + 1));
    }
  },
  migra() {
    const [journal, tx] = a;
    const d = abrir(archivo, journal);
    if (tx === 'si') d.exec('BEGIN IMMEDIATE');
    d.exec("ALTER TABLE c ADD COLUMN nueva TEXT; UPDATE c SET nueva='a'");
    decir('medio');
    dormir(30000);
  },
  migra2() {
    try {
      const d = abrir(archivo, null);
      const v = () => uno(d, 'PRAGMA user_version');
      if (a[0] === 'afuera') {
        if (v() < 1) d.exec('BEGIN IMMEDIATE; CREATE TABLE c(a); PRAGMA user_version=1; COMMIT');
      } else {
        d.exec('BEGIN IMMEDIATE');
        if (v() < 1) d.exec('CREATE TABLE c(a); PRAGMA user_version=1');
        d.exec('COMMIT');
      }
      decir('ok');
    } catch (e) {
      decir(e.message);
    }
  },
  continuo() {
    const [journal, ms, pausa] = a;
    const d = abrir(archivo, journal);
    const r = { w: 0, errores: {}, maxMs: 0 };
    const t = Date.now();
    decir('listo');
    while (Date.now() - t < Number(ms)) {
      const p = performance.now();
      try {
        d.prepare('INSERT INTO t VALUES(?,?)').run(`w${r.w}`, 'z');
        r.w++;
      } catch (e) {
        r.errores[e.message] = (r.errores[e.message] ?? 0) + 1;
      }
      r.maxMs = Math.max(r.maxMs, Math.round(performance.now() - p));
      dormir(Number(pausa));
    }
    decir(r);
  },
  // Mantiene la base abierta, con una lectura hecha, hasta que lo maten.
  mantener() {
    const d = abrir(archivo, null);
    uno(d, 'SELECT count(*) FROM t');
    decir('abierta');
    dormir(60000);
    d.close();
  },
};
modos[modo]();
