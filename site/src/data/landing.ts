/**
 * Textos y listas de la portada (`components/landing/`). Los textos con formato usan la marca de `lib/rich.ts`
 * (`ARCLI`, `**negrita**`, `[link](ruta/)` y `{ia}`). Las rutas son del sitio, sin `/` adelante (`url()` le pone la base).
 *
 * El logo, la versión y el prompt de instalación no están acá: salen del CLI y del README (`generated/brand.json`). Los
 * atajos y las páginas de los comprobantes salen de `generated/comprobantes.json` (de `docs/comprobantes/`).
 */
import { nodeVersion } from '../generated/brand.json';
import COMPROBANTES from '../generated/comprobantes.json';

/** Una línea de `Snippet.astro`: el comentario y el comando, sin el `$`. */
export interface SnippetLine {
  readonly cmd: string;
  readonly comment: string;
}

/** Un link: el texto y la ruta del sitio. */
export interface LandingLink {
  readonly href: string;
  readonly text: string;
}

// Hero

export const HERO = {
  lead: 'Emití facturas, consultá comprobantes y automatizá tu facturación con comandos, un asistente interactivo o tu IA favorita.',
  meta: ['Windows, macOS y Linux', 'Código abierto, licencia MIT'],
  release: { href: 'ayuda/novedades/', text: 'Mirá qué trae esta versión' },
  tagline: 'Gratis. De código abierto. Sin entrar al portal de ARCA.',
  title: 'El CLI de facturación electrónica de ARCA (ex AFIP), desde tu terminal',
} as const;

export const HERO_ACTIONS = {
  ghost: { href: 'comprobantes/cual-me-toca/', text: '¿Qué comprobante me toca?' },
  primary: { href: 'empezar/instalar/', text: 'Empezar' },
} as const satisfies Record<string, LandingLink>;

/** Los nombres que van rotando donde dice `{ia}`. */
export const AI_NAMES = ['Claude', 'ChatGPT', 'Gemini', 'Copilot'] as const;

// Demo

export type DemoKey = 'asistente' | 'comandos' | 'consultas' | 'ia';

export interface Demo {
  readonly alt?: string;
  readonly caption: string;
  readonly key: DemoKey;
  readonly label: string;
  /** El GIF, en `public/`; sin `src` es el chat. */
  readonly src?: string;
}

export const DEMOS: readonly Demo[] = [
  {
    alt: 'El asistente de ARCLI emitiendo una Factura C en testing',
    caption: 'Una Factura C en testing con el asistente: monto, receptor, vista previa, comando equivalente y CAE.',
    key: 'asistente',
    label: 'Asistente',
    src: 'assets/demo/interactivo.gif',
  },
  {
    alt: 'ARCLI emitiendo con un comando y flags',
    caption: 'Lo mismo con un comando: vista previa, confirmación y CAE. Ideal para repetir o automatizar.',
    key: 'comandos',
    label: 'Comandos',
    src: 'assets/demo/comandos.gif',
  },
  {
    caption:
      'Le pedís la factura a tu asistente de IA (Claude, ChatGPT, Gemini u otro) en tus palabras: usa ARCLI para armar el comando, te muestra la vista previa y emite cuando confirmás.',
    key: 'ia',
    label: 'Con IA',
  },
  {
    alt: 'ARCLI consultando los últimos comprobantes',
    caption: 'Los últimos comprobantes emitidos y el detalle de uno, sin emitir nada.',
    key: 'consultas',
    label: 'Consultas',
    src: 'assets/demo/consultar.gif',
  },
];

/** Un mensaje del chat de la demo: el texto, el comando que corre (sin `$`) y el texto de después, en ese orden. */
export interface ChatMessage {
  readonly after?: string;
  readonly cmd?: string;
  readonly text?: string;
  readonly who: 'bot' | 'user';
}

export const CHAT_HEAD = {
  local: 'ARCLI corre en tu computadora',
  title: 'Chat con',
  who: 'tu asistente de IA',
} as const;

export const CHAT: readonly ChatMessage[] = [
  {
    text: 'Hola {ia}, facturale $ 150.000 a Juan Pérez, consumidor final, por el desarrollo de octubre. En testing.',
    who: 'user',
  },
  {
    cmd: 'arcli fc -m 150000 --cs --consumidor-final --testing --json',
    text: 'Uso **ARCLI**, que tenés instalado, para armar la vista previa:',
    who: 'bot',
  },
  {
    text: 'Es una Factura C de $ 150.000 a consumidor final, por servicios, en el punto de venta 3. ¿La emito?',
    who: 'bot',
  },
  { text: 'Sí, emitila.', who: 'user' },
  {
    after: 'Listo: **Factura C 00003-00000118**, aprobada. CAE 86451064378488, vence el 18/11/2026.',
    cmd: 'arcli fc -m 150000 --cs --consumidor-final --testing --emitir --json',
    who: 'bot',
  },
];

// Instalación

export type InstallKey = 'ia' | 'npm' | 'pnpm' | 'yarn';

export interface InstallOption {
  readonly badge?: string;
  /** El comando; la opción `ia` copia el prompt del README. */
  readonly cmd?: string;
  readonly key: InstallKey;
  readonly label: string;
  readonly note: string;
}

/** La versión mínima de Node.js, de `engines` del `package.json` del CLI. */
const NODE = nodeVersion;

/** Las notas de npm y yarn son las de `docs/instalar.md` y el README. */
export const INSTALL: readonly InstallOption[] = [
  {
    badge: 'fácil',
    key: 'ia',
    label: 'Con IA',
    note: 'Copialo y pegáselo a {ia}: revisa Node, instala **ARCLI** y crea el ícono. Sirve también para actualizar.',
  },
  {
    cmd: 'npm install -g arcli',
    key: 'npm',
    label: 'npm',
    note: `Necesitás Node.js ${NODE} o superior. Para actualizar, el mismo comando con arcli@latest.`,
  },
  { cmd: 'pnpm add -g arcli', key: 'pnpm', label: 'pnpm', note: `Necesitás Node.js ${NODE} o superior.` },
  {
    cmd: 'yarn global add arcli',
    key: 'yarn',
    label: 'yarn',
    note: 'Solo Yarn 1: Yarn 2 o superior no instala paquetes globales.',
  },
];

export const INSTALL_HEADING = 'Instalalo en 5 minutos';

/** El botón de copiar: como está, después de copiar y si el navegador no deja copiar (queda seleccionado). */
export const INSTALL_COPY = { done: 'Copiado', idle: 'Copiar', selected: 'Seleccionado: ⌘C' } as const;

// ¿Qué facturás?

/** Una fila de comprobante: los atajos, el título, para qué sirve y la página (`comprobantes/<slug>/`). */
export interface VoucherRow {
  readonly atajo: string;
  readonly slug: string;
  readonly text: string;
  readonly title: string;
}

export type ProfileKey = 'expo' | 'mono' | 'ri';

export interface Profile {
  /** Los atajos de "Cómo es facturar" (el chipboard). */
  readonly chips: readonly string[];
  readonly key: ProfileKey;
  readonly label: string;
  readonly rows: readonly VoucherRow[];
  /** El nombre corto, en el chipboard. */
  readonly short: string;
  readonly snippet: readonly SnippetLine[];
}

/** Las letras de cada perfil. */
const PROFILE_LETTERS: Record<ProfileKey, readonly string[]> = { expo: ['e'], mono: ['c'], ri: ['a', 'b'] };

/** Los tipos (`factura`, `nota-credito`…) en el orden de los datos. */
const KINDS = [...new Set(COMPROBANTES.map((voucher) => voucher.comando))];

/** Los atajos de un perfil, por tipo y, dentro de cada tipo, por letra (fa fb, nca ncb…). */
function profileChips(key: ProfileKey): string[] {
  const letters = PROFILE_LETTERS[key];

  return KINDS.flatMap((kind) =>
    letters.flatMap((letter) =>
      COMPROBANTES.filter((voucher) => voucher.comando === kind && voucher.letra === letter).map(
        (voucher) => voucher.atajo,
      ),
    ),
  );
}

/** Una fila desde sus atajos: la página es la del primero; falla si un atajo no está en los datos. */
function row(atajos: readonly string[], title: string, text: string): VoucherRow {
  const [first] = atajos.map((atajo) => {
    const voucher = COMPROBANTES.find((item) => item.atajo === atajo);

    if (!voucher) throw new Error(`landing.ts: el atajo ${atajo} no está en generated/comprobantes.json.`);

    return voucher;
  });

  return { atajo: atajos.join(' · '), slug: first.slug, text, title };
}

export const PROFILES: readonly Profile[] = [
  {
    chips: profileChips('mono'),
    key: 'mono',
    label: 'Monotributo',
    rows: [
      row(['fc'], 'Factura C', 'A consumidor final o a empresas'),
      row(['ncc', 'ndc'], 'Notas de crédito y débito C', 'Sobre una factura o un recibo'),
      row(['rc'], 'Recibo C', 'Para documentar un cobro'),
      row(['fcec'], 'FCE C', 'A empresas obligadas a recibirla'),
    ],
    short: 'Monotributo',
    snippet: [
      { cmd: 'arcli fc -m 15000 --cs --cfinal', comment: 'Factura C a consumidor final' },
      {
        cmd: 'arcli ncc -m 5000 --cs --cfinal --ac fc --apv 3 --ar 142 --acuit 20333333334',
        comment: 'Nota de crédito sobre la 0003-00000142',
      },
    ],
  },
  {
    chips: profileChips('ri'),
    key: 'ri',
    label: 'Responsable inscripto',
    rows: [
      row(['fa'], 'Factura A', 'A otro responsable inscripto'),
      row(['fb'], 'Factura B', 'A consumidor final, monotributo o exento'),
      row(['nca', 'nda'], 'Notas A', 'Sobre una factura o un recibo A'),
      row(['ncb', 'ndb'], 'Notas B', 'Sobre una factura o un recibo B'),
      row(['ra', 'rb'], 'Recibos A y B', 'Para documentar un cobro'),
      row(['fcea', 'fceb'], 'FCE A y B', 'A empresas obligadas a recibirla'),
    ],
    short: 'Resp. inscripto',
    snippet: [
      { cmd: 'arcli fa -m 121000 --cs --cuit 20168598204', comment: 'Factura A: el IVA sale solo del monto' },
      { cmd: 'arcli fb -m 11050 --cp --cfinal --alicuota 10.5', comment: 'Factura B con alícuota de 10,5%' },
    ],
  },
  {
    chips: profileChips('expo'),
    key: 'expo',
    label: 'Exportador',
    rows: [
      row(['fe'], 'Factura E', 'Bienes o servicios al exterior'),
      row(['nce', 'nde'], 'Notas E', 'Toman los datos de la factura'),
    ],
    short: 'Exportador',
    snippet: [
      {
        cmd: 'arcli fe -m 1500 --moneda USD --cliente "ACME LLC" --pais-destino 212',
        comment: 'Servicios a un cliente de Estados Unidos, en dólares',
      },
      { cmd: 'arcli nce -m 500 --ar 1 --apv 4', comment: 'Nota de crédito sobre la Factura E 4-1' },
    ],
  },
];

// Encabezados de las secciones

/** El encabezado de una sección: la etiqueta de arriba (con formato), el título y la bajada. */
export interface SectionHead {
  readonly eyebrow: string;
  readonly lead?: string;
  readonly title: string;
}

export const SECTIONS = {
  compare: {
    eyebrow: '¿Por qué ARCLI?',
    lead: 'Los dos emiten comprobantes válidos en ARCA. Depende de cuánto facturás y de cómo te gusta trabajar.',
    title: '¿Factura en línea o ARCLI?',
  },
  faq: { eyebrow: 'Preguntas frecuentes', title: 'Antes de empezar' },
  features: { eyebrow: 'Características', title: 'Lo que hace por vos' },
  firstSteps: {
    eyebrow: 'Para empezar',
    lead: 'No hace falta saber de terminal. En testing nada tiene validez fiscal, así que podés probar sin miedo.',
    title: 'Tu primera factura en tres pasos',
  },
  howItWorks: { eyebrow: 'Cómo es facturar con ARCLI', title: 'Del monto al CAE, en cuatro pasos' },
  vouchers: { eyebrow: 'Comprobantes', title: '¿Qué facturás?' },
  ways: {
    eyebrow: 'Formas de uso',
    lead: 'Tenés tres formas y todas hacen lo mismo, pero según lo que necesites hay una que se ajusta mejor a vos.',
    title: '¿Cómo te gustaría usarlo?',
  },
} as const satisfies Record<string, SectionHead>;

// Para empezar

export const FIRST_STEPS = [
  {
    text: 'Pegale el prompt a tu asistente de IA o seguí los pasos a mano.',
    time: '~5 minutos',
    title: 'Instalá ARCLI',
  },
  {
    text: 'ARCLI arma el pedido y vos lo subís a ARCA con tu clave fiscal.',
    time: '~15 minutos',
    title: 'Sacá el certificado',
  },
  {
    text: 'Abrí ARCLI y seguí el asistente. Cuando estés seguro, pasás a producción.',
    time: '~2 minutos',
    title: 'Emití en testing',
  },
] as const;

// Cómo es facturar (los visuales de cada paso están en `HowItWorks.astro`)

export const HOW_STEPS = {
  data: {
    text: 'Con el asistente, paso a paso y con flechas. O con un comando, que podés repetir, pegar en un script o pedirle a tu IA. Validan y emiten igual.',
    title: 'Cargás los datos como prefieras',
  },
  pick: {
    link: { href: 'comprobantes/cual-me-toca/', text: '¿Cuál me toca?' },
    text: 'Monotributo, responsable inscripto o exportador: cada comprobante tiene un atajo corto. El asistente te lo pregunta.',
    title: 'Elegís el comprobante',
  },
  result: {
    text: 'El CAE apenas ARCA aprueba y el PDF con el código QR, en tu carpeta. Si la conexión se corta, te dice cómo verificar antes de reintentar.',
    title: 'Recibís el CAE y el PDF',
  },
  review: {
    text: 'ARCLI valida todo con las reglas de ARCA y te muestra la vista previa. Nada sale hasta que confirmás.',
    title: 'Revisás antes de emitir',
  },
} as const;

export const HOW_SNIPPET: readonly SnippetLine[] = [
  { cmd: 'arcli fc -m 15000 --cs --cfinal', comment: 'Factura C a consumidor final, por servicios' },
  { cmd: 'arcli ultimos fc', comment: 'Las últimas facturas C emitidas' },
];

/** Las filas de un panel de terminal (`TermPanel.astro`): etiqueta y valor. */
export type TermRows = readonly (readonly [string, string])[];

export const HOW_PREVIEW = {
  ask: '¿Emitimos?',
  hint: '(s/N)',
  label: 'Vista previa de una Factura C',
  rows: [
    ['Receptor', 'Consumidor final'],
    ['Concepto', 'Servicios, del 01/11 al 30/11'],
    ['Punto de venta', '3'],
    ['Importe total', '$ 15.000'],
    ['Entorno', 'testing'],
  ] satisfies TermRows,
  title: 'FACTURA C · VISTA PREVIA',
} as const;

export const HOW_RESULT = {
  label: 'Resultado de una emisión aprobada',
  pdfAlt: 'PDF de una Factura C generado por ARCLI',
  pdfSrc: 'assets/demo/pdf-factura.png',
  rows: [
    ['CAE', '86451064378488'],
    ['Número', '00003-00000118'],
    ['Importe total', '$ 15.000'],
  ] satisfies TermRows,
  status: 'APROBADO',
  title: 'FACTURA C',
} as const;

// Formas de uso

export const WAYS = [
  {
    do: 'arcli',
    href: 'uso/asistente/',
    kind: 'cmd',
    question: 'Que me guíe paso a paso',
    target: 'Asistente',
    verb: 'Escribís',
  },
  {
    do: 'arcli fc -m 15000 --cs --cfinal',
    href: 'uso/comandos/',
    kind: 'cmd',
    question: 'En una línea o desde un script',
    target: 'Comandos',
    verb: 'Escribís',
  },
  {
    do: 'Facturale $ 15.000 a Juan, consumidor final',
    href: 'uso/con-ia/',
    kind: 'ask',
    question: 'Con mi asistente preferido',
    target: 'Con IA',
    verb: 'Le pedís',
  },
] as const;

// Características

export const FEATURES = [
  { text: 'Nada sale sin que confirmes.', title: 'Vista previa antes de emitir.' },
  { text: 'Con el código QR y tus datos, en tu carpeta.', title: 'CAE y PDF.' },
  { text: 'Antes de llamar al servicio.', title: 'Validado con el manual de ARCA.' },
  { text: 'Con solo el CUIT.', title: 'El receptor desde el padrón.' },
  { text: 'Y armá notas sobre la original.', title: 'Repetí facturas.' },
  { text: 'Últimos comprobantes, estado y cotización.', title: 'Consultas sin emitir.' },
  { text: 'Tus datos quedan en tu computadora.', title: 'Sin servidores intermedios.' },
  { text: 'JSON, lotes y una guía para IAs.', title: 'Listo para automatizar.' },
] as const;

// ¿Factura en línea o ARCLI?

export const COMPARE = {
  head: ['Factura en línea', 'ARCLI'],
  note: 'Usan puntos de venta distintos: uno de Factura en línea no sirve para ARCLI.',
  noteLink: { href: 'empezar/certificado-produccion/', text: 'Cómo crear uno para web service' },
  /** Fila, Factura en línea y ARCLI; `no` marca la celda de Factura en línea que dice que no. */
  rows: [
    { cells: ['Instalación', 'Nada: entrás con tu clave fiscal', 'Una vez, en tu computadora'] },
    { cells: ['Cargar un comprobante', 'Campo por campo', 'El asistente o un comando'] },
    { cells: ['Notas de crédito', 'Cargás los datos otra vez', 'Toman los datos de la factura'] },
    { cells: ['PDF', 'Lo bajás de la web', 'Sale solo, con tus datos, en tu carpeta'] },
    { cells: ['Desde una planilla, un sistema o una IA', 'No', 'Sí'], no: true },
    { cells: ['Conviene si', 'Facturás pocas veces al mes', 'Facturás seguido o repetís facturas'] },
  ],
} as const;

// Seguridad

export const TRUST = [
  { icon: 'candado', text: 'Habla directo con ARCA.', title: 'Sin servidores intermedios' },
  { icon: 'escudo-liso', text: 'Producción se pide a propósito.', title: 'Testing por defecto' },
  { icon: 'cruz', text: 'Ante la duda, no reintenta.', title: 'No duplica' },
  { icon: 'codigo', text: 'Licencia MIT.', title: 'Código abierto' },
] as const;

// Preguntas frecuentes: dos columnas, la primera abierta.

export const FAQ = [
  [
    {
      answer:
        'Sí. ARCLI es código abierto con licencia MIT y no tiene planes pagos. Lo único que necesitás es tu clave fiscal y un certificado de ARCA, que también es gratis.',
      question: '¿Es gratis?',
    },
    {
      answer: 'No. Con el asistente elegís todo con flechas y Enter. Los comandos están para quien quiera automatizar.',
      question: '¿Necesito saber programar?',
    },
    {
      answer: 'Sí. Emitís Factura C, sus notas de crédito y débito, y Recibo C.',
      question: '¿Sirve si soy monotributista?',
    },
  ],
  [
    {
      answer:
        'El entorno de homologación de ARCA: los comprobantes no tienen validez fiscal. Sirve para probar todo antes de pasar a producción.',
      question: '¿Qué es testing?',
    },
    {
      answer:
        'No. ARCLI es un proyecto independiente que usa los servicios web públicos de ARCA, los mismos que usan los sistemas de facturación.',
      question: '¿Es un producto oficial de ARCA?',
    },
    {
      answer:
        'Cada error dice qué pasó y cómo seguir. La guía de [problemas frecuentes](ayuda/problemas-frecuentes/) tiene las causas más comunes, y podés abrir un issue en GitHub.',
      question: '¿Qué pasa si algo sale mal?',
    },
  ],
] as const;

// Cierre

export const CTA = {
  actions: {
    ghost: { href: 'empezar/certificado-testing/', text: 'Sacar el certificado' },
    primary: { href: 'empezar/instalar/', text: 'Instalar ARCLI' },
  },
  text: 'Emití facturas de prueba hasta que estés seguro. Pasar a producción es un flag.',
  title: 'Probalo en testing, sin riesgo',
} as const;
