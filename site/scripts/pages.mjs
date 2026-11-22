/**
 * Que paginas tiene el sitio y de donde sale cada una: el menu (secciones, orden, iconos, grupos), los alias y las
 * carpetas de imagenes. Solo datos; la logica esta en `transforms/` y `outputs/`.
 */
import { readVouchers, VOUCHER_DIR } from './lib/vouchers.mjs';

/** Secciones generadas: se borran y se vuelven a escribir en cada corrida. */
export const GENERATED_SECTIONS = ['empezar', 'uso', 'comprobantes', 'mas', 'referencia', 'ayuda'];

/** Las secciones del menu, en orden, con su nombre y la entrada del encabezado. */
export const SECTIONS = [
  { dir: 'empezar', label: 'Empezar' },
  { dir: 'uso', label: 'Formas de uso' },
  { dir: 'comprobantes', label: 'Comprobantes' },
  { dir: 'mas', label: 'Más' },
  { dir: 'referencia', label: 'Referencia' },
  { dir: 'ayuda', label: 'Ayuda' },
];

/**
 * Las paginas de `docs/comprobantes/` (las genera `yarn docs:comprobantes`): primero "¿Cuál me toca?" y despues una por
 * comprobante, agrupadas por familia en el orden del comentario `<!-- arcli: familia=... orden=... -->`.
 */
function voucherPages() {
  const pages = readVouchers().map((voucher) => ({
    group: voucher.familia,
    icon: voucher.icono,
    label: voucher.titulo,
    slug: `comprobantes/${voucher.slug}`,
    src: `${VOUCHER_DIR}/${voucher.slug}.md`,
    voucher: true,
  }));

  return [
    {
      description:
        'Qué comprobante te toca según tu condición frente al IVA y a quién le facturás, con una página por comprobante.',
      icon: 'pregunta',
      label: '¿Cuál me toca?',
      slug: 'comprobantes/cual-me-toca',
      src: `${VOUCHER_DIR}/README.md`,
    },
    ...pages,
  ];
}

/**
 * Que pagina sale de cada archivo. `label` es el nombre corto del menu; sin el, el titulo del documento.
 * El orden del menu es el de esta lista dentro de cada seccion. `description` (meta y vista previa al compartir) sale
 * de la introduccion del documento (ver `pageDescription`); se declara aca solo cuando esa introduccion no sirve sola.
 */
export const PAGES = [
  { icon: 'descarga', label: 'Instalar y configurar', slug: 'empezar/instalar', src: 'docs/instalar.md' },
  {
    description:
      'Cómo sacar el certificado de testing de ARCA para probar ARCLI sin validez fiscal: 4 pasos, unos 15 minutos.',
    icon: 'frasco',
    label: 'Certificado de testing',
    slug: 'empezar/certificado-testing',
    src: 'docs/certificado-testing.md',
  },
  {
    description:
      'Cómo sacar el certificado de producción de ARCA para facturar con validez fiscal: los mismos pasos que en testing.',
    icon: 'escudo',
    label: 'Certificado de producción',
    slug: 'empezar/certificado-produccion',
    src: 'docs/certificado-produccion.md',
  },
  {
    hidden: true,
    label: 'Certificado de testing: guía completa',
    slug: 'empezar/certificado-testing-completo',
    src: 'docs/certificado-testing-completa.md',
  },
  {
    hidden: true,
    label: 'Certificado de producción: guía completa',
    slug: 'empezar/certificado-produccion-completo',
    src: 'docs/certificado-produccion-completa.md',
  },
  { icon: 'flechas', label: 'Cambiar de entorno', slug: 'empezar/entornos', src: 'docs/entornos.md' },
  { icon: 'capas', label: 'Cómo funciona', slug: 'empezar/como-funciona', src: 'docs/mental-model.md' },
  { icon: 'chat', label: 'Asistente', slug: 'uso/asistente', src: 'docs/formas-de-uso/asistente.md' },
  {
    description:
      'Emití con ARCLI en una línea: conviene si facturás seguido, si repetís siempre lo mismo o para automatizar.',
    icon: 'terminal',
    label: 'Comandos',
    slug: 'uso/comandos',
    src: 'docs/formas-de-uso/comandos.md',
  },
  { icon: 'chispa', label: 'Con IA', slug: 'uso/con-ia', src: 'docs/formas-de-uso/con-ia.md' },
  // Las guías completas: no van en el menú, se llega desde el link al final de la versión corta.
  { hidden: true, label: 'Modo interactivo', slug: 'uso/asistente-completo', src: 'docs/modo-interactivo.md' },
  {
    description:
      'Cómo un asistente de IA con acceso a la terminal emite con ARCLI: reglas claras y una salida --json estable.',
    hidden: true,
    label: 'Automatizar con IA',
    slug: 'uso/con-ia-completo',
    src: 'docs/automatizar-con-ia.md',
  },
  ...voucherPages(),
  {
    group: 'Explicaciones',
    icon: 'libro',
    label: 'Cómo funcionan las notas',
    slug: 'comprobantes/notas',
    src: 'docs/notas-credito-debito.md',
  },
  { group: 'Explicaciones', icon: 'libro', label: 'Qué es la FCE', slug: 'comprobantes/fce', src: 'docs/fce.md' },
  {
    group: 'Explicaciones',
    icon: 'libro',
    label: 'Exportación paso a paso',
    slug: 'comprobantes/exportacion',
    src: 'docs/exportacion.md',
  },
  {
    description:
      'Consultá en ARCA sin emitir nada: tus comprobantes, el estado de ARCA, sus tablas y los datos de un CUIT.',
    icon: 'lupa',
    label: 'Consultas sin emitir',
    slug: 'mas/consultas',
    src: 'docs/consultas.md',
  },
  { icon: 'pdf', label: 'PDF de comprobantes', slug: 'mas/pdf', src: 'docs/pdf-en-corto.md' },
  { hidden: true, label: 'PDF de comprobantes: guía completa', slug: 'mas/pdf-completo', src: 'docs/pdf.md' },
  { icon: 'pila', label: 'Lotes y JSON', slug: 'mas/lotes-y-json', src: 'docs/lotes-y-json.md' },
  { icon: 'lista', label: 'Comandos y flags', slug: 'referencia/comandos', src: 'docs/comandos.md' },
  {
    description: 'La referencia completa de ARCLI: cada comando con sus flags, sus valores y ejemplos.',
    hidden: true,
    label: 'Referencia completa del CLI',
    slug: 'referencia/comandos-completo',
    src: 'docs/cli-reference.md',
  },
  { icon: 'ajustes', label: 'Configuración', slug: 'referencia/configuracion', src: 'docs/configuration.md' },
  {
    description:
      'El formato de entrada (`--cargar`) y de salida (`--json`) de ARCLI, para scripts, sistemas propios e IA.',
    icon: 'llaves',
    label: 'Entrada y salida (JSON)',
    slug: 'referencia/entrada-y-salida',
    src: 'docs/input-output.md',
  },
  {
    description:
      'Qué controla ARCLI antes de mandar un comprobante a ARCA y qué restricciones y errores devuelve ARCA.',
    icon: 'check',
    label: 'Reglas de validación',
    slug: 'referencia/validaciones',
    src: 'docs/validation-rules.md',
  },
  { icon: 'glosario', label: 'Glosario', slug: 'referencia/glosario', src: 'docs/glossary.md' },
  { icon: 'alerta', label: 'Limitaciones', slug: 'referencia/limitaciones', src: 'docs/limitations.md' },
  { icon: 'llave', label: 'Problemas frecuentes', slug: 'ayuda/problemas-frecuentes', src: 'docs/troubleshooting.md' },
  {
    description: 'Qué cambió en cada versión de ARCLI y qué tenés que tener en cuenta si ya lo usás.',
    icon: 'campana',
    label: 'Novedades',
    slug: 'ayuda/novedades',
    src: 'CHANGELOG.md',
    title: 'Novedades de cada versión',
  },
];

/**
 * Archivos que quedaron como indice en docs/ (para no romper los links de GitHub que ya circulan, y los que imprimen
 * las versiones publicadas del CLI): en el sitio, sus links van a la pagina que tiene el contenido.
 */
export const ALIASES = {
  'docs/obtencion-certificados.md': 'docs/certificado-testing.md',
  'docs/usage-patterns.md': 'docs/comprobantes/README.md',
};

/** Carpetas de `docs/assets` que usan las paginas (las cintas de VHS no). */
export const ASSET_FOLDERS = ['certificados', 'demo', 'imagenes'];
