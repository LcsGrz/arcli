import { spawnSync } from 'node:child_process';

import { carpeta, caso } from './comun.mjs';

const r = (codigo, ...flags) => {
  const x = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', codigo], { encoding: 'utf8' });
  return { out: x.stdout.trim(), err: x.stderr.trim() };
};
const linea = (s) => s.split('\n').find((x) => /Error|Warning/.test(x)) ?? (s || 'ninguno');

await caso('1 exportaciones', (f) =>
  f(r("import * as s from 'node:sqlite';console.log(Object.keys(s).join(' '))").out),
);
await caso('1 Database', (f) =>
  f(r("import * as s from 'node:sqlite';console.log(typeof s.Database, s.Database===s.DatabaseSync)").out),
);
await caso('1 import { Database }', (f) => f(linea(r("import {Database} from 'node:sqlite'").err)));
await caso('1 Database ?? DatabaseSync', (f) => {
  const x = r(
    "const s=await import('node:sqlite');new (s.Database??s.DatabaseSync)(':memory:').close();console.log('ok')",
  );
  f(x.out || x.err, x.out === 'ok');
});
await caso('1 aviso al importar', (f) => f(linea(r("import 'node:sqlite'").err)));
const USAR = "import {DatabaseSync} from 'node:sqlite';new DatabaseSync(':memory:')";
await caso('1 aviso al usar DatabaseSync', (f) => f(linea(r(USAR).err)));
await caso('1 --pending-deprecation', (f) => f(r(USAR, '--pending-deprecation').err || 'ninguno'));

const EMITIR =
  "process.emitWarning('otro','ExperimentalWarning');process.emitWarning('SQLite otro','DeprecationWarning');process.emitWarning('normal');";
const filtro = (carga) =>
  `const o=process.emitWarning;process.emitWarning=function(w,...a){if(a[0]==='ExperimentalWarning'&&String(w).startsWith('SQLite '))return;return Reflect.apply(o,process,[w,...a])};try{${carga}}finally{process.emitWarning=o}${EMITIR}`;
for (const [nombre, carga] of [
  ['await import', "await import('node:sqlite')"],
  ['getBuiltinModule', "process.getBuiltinModule('node:sqlite')"],
]) {
  await caso(`1 filtro del aviso con ${nombre}`, (f) => {
    const { err } = r(filtro(carga));
    const oculto = !/SQLite is an/.test(err);
    const otros = ['Warning: otro', 'Warning: SQLite otro', 'Warning: normal'].filter((x) => err.includes(x)).length;
    f(`aviso de SQLite oculto: ${oculto}; otros avisos que siguen: ${otros}/3`, oculto && otros === 3);
  });
}
await caso('1 import estático antes del filtro', (f) =>
  f(linea(r("import * as s from 'node:sqlite';process.emitWarning=()=>{}").err)),
);
await caso('1 --disable-warning', (f) =>
  f(r(`import 'node:sqlite';${EMITIR}`, '--disable-warning=ExperimentalWarning').err),
);

const mediana = (codigo, n = 15) => {
  const v = Array.from({ length: n }, () => Number(r(codigo).out)).sort((a, b) => a - b);
  return `mediana ${v[n >> 1].toFixed(2)} ms, peor ${v[n - 1].toFixed(2)} ms`;
};
const SIN = 'process.emitWarning=()=>{};';
await caso('1 tiempo de import', (f) =>
  f(mediana(`${SIN}const a=performance.now();await import('node:sqlite');console.log(performance.now()-a)`)),
);
await caso('1 tiempo de abrir y crear tabla', (f) => {
  const dir = JSON.stringify(carpeta('p01'));
  f(
    mediana(
      `${SIN}const s=await import('node:sqlite');const fs=await import('node:fs');const p=fs.mkdtempSync(${dir}+'/a');const a=performance.now();const d=new (s.Database??s.DatabaseSync)(p+'/x.db');d.exec('create table t(a)');d.close();console.log(performance.now()-a)`,
    ),
  );
});
