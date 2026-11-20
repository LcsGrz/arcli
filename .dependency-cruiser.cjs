// Ciclos entre módulos de src/. Las capas las controla ESLint (no-restricted-imports); acá solo lo que ESLint no ve.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Un ciclo de imports: partí el módulo o mové lo compartido a uno que no dependa de ninguno de los dos.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Solo imports que existen en ejecución: un ciclo de `import type` no rompe la carga de los módulos en ESM.
    tsPreCompilationDeps: false,
  },
};
