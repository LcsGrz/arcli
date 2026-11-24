import { shortenPath } from '../paths/mask-path';

/** El error con que Node avisa que no pudo con un archivo: `EPERM`, `EACCES`, `ENOSPC`… La red trae los mismos campos. */
export function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'syscall' in error && 'code' in error;
}

interface FileErrorText {
  readonly reason: string;
  readonly suggestion: string;
}

const PERMISSION_SUGGESTION =
  'Revisá que tu usuario tenga permiso ahí y que otro programa no lo esté usando, o elegí otra ruta.';
const TOO_MANY_FILES = { reason: 'hay demasiados archivos abiertos', suggestion: 'Cerrá otros programas.' };

/** Por que no se pudo y que hacer. No dicen de reintentar: el comando pudo haber emitido antes. */
const FILE_ERRORS: ReadonlyMap<string, FileErrorText> = new Map([
  ['EACCES', { reason: 'no tenés permiso', suggestion: PERMISSION_SUGGESTION }],
  ['EBUSY', { reason: 'lo está usando otro programa', suggestion: 'Cerrá el programa que lo está usando.' }],
  ['EDQUOT', { reason: 'se acabó tu espacio en el disco', suggestion: 'Liberá espacio en el disco o usá otro.' }],
  ['EEXIST', { reason: 'ya hay un archivo con ese nombre', suggestion: 'Movelo o renombralo, o elegí otra ruta.' }],
  [
    'EISDIR',
    {
      reason: 'es una carpeta',
      suggestion: 'Tiene que ser un archivo: revisá la ruta o, si esa carpeta no va ahí, renombrala.',
    },
  ],
  ['EMFILE', TOO_MANY_FILES],
  ['ENAMETOOLONG', { reason: 'la ruta es demasiado larga', suggestion: 'Usá una ruta más corta.' }],
  ['ENFILE', TOO_MANY_FILES],
  ['ENOENT', { reason: 'no existe', suggestion: 'Revisá que la ruta exista.' }],
  ['ENOSPC', { reason: 'no queda espacio en el disco', suggestion: 'Liberá espacio en el disco o usá otro.' }],
  [
    'ENOTDIR',
    {
      reason: 'una parte de la ruta no es una carpeta',
      suggestion: 'Revisá la ruta: hay un archivo donde tendría que haber una carpeta.',
    },
  ],
  ['EPERM', { reason: 'el sistema no lo permite', suggestion: PERMISSION_SUGGESTION }],
  [
    'EROFS',
    { reason: 'el disco es de solo lectura', suggestion: 'Usá una carpeta de un disco en el que puedas escribir.' },
  ],
]);

/** Que se quiso hacer, por la operacion del sistema. Las que no estan (`connect`, `spawn`…) no son de archivos. */
const FILE_OPERATIONS: ReadonlyMap<string, string> = new Map([
  ['access', 'abrir'],
  ['chmod', 'cambiar los permisos de'],
  ['copyfile', 'copiar'],
  ['fchmod', 'cambiar los permisos de'],
  ['fsync', 'escribir'],
  ['ftruncate', 'escribir'],
  ['lstat', 'abrir'],
  ['mkdir', 'crear la carpeta'],
  ['open', 'abrir'],
  ['read', 'leer'],
  ['realpath', 'abrir'],
  ['rename', 'guardar'],
  ['rm', 'borrar'],
  ['rmdir', 'borrar'],
  ['scandir', 'leer la carpeta'],
  ['stat', 'abrir'],
  ['unlink', 'borrar'],
  ['write', 'escribir'],
]);

/** El temporal con el que `conf` guarda el config.json. */
const TEMPORARY_SUFFIX = /\.tmp-[0-9a-f]+$/;
/** En macOS una `.app` se ve como un archivo: nombrar una carpeta de adentro no le dice nada a nadie. */
const INSIDE_MAC_APP = /(\.app)\/.*$/;

/** Por que no se pudo, sin nombrar el archivo; sin definir si el codigo no se conoce. */
export function fileErrorReason(code: string | undefined): string | undefined {
  return FILE_ERRORS.get(code ?? '')?.reason;
}

/**
 * Un error de archivo de Node: que se quiso hacer, sobre que (ruta abreviada), por que y que hacer. Sin definir si es
 * de otra cosa o no se conoce. La red y los procesos comparten codigos (`connect EACCES`, `spawn npm EACCES`): los de
 * archivo empiezan con el codigo y dos puntos.
 */
export function describeFileError(
  error: unknown,
): { readonly message: string; readonly suggestion: string } | undefined {
  if (!isFileSystemError(error) || !error.message.startsWith(`${error.code}: `)) {
    return undefined;
  }

  const text = FILE_ERRORS.get(error.code ?? '');
  const operation = FILE_OPERATIONS.get(error.syscall ?? '');

  if (!text || !operation) {
    return undefined;
  }

  const { dest, path } = error as NodeJS.ErrnoException & { readonly dest?: string };
  const temporary = path !== undefined && TEMPORARY_SUFFIX.test(path);
  // Al copiar o mover, lo que no existe es el origen.
  const target = (error.code === 'ENOENT' ? path : (dest ?? path))
    ?.replace(TEMPORARY_SUFFIX, '')
    .replace(INSIDE_MAC_APP, '$1');
  const action = temporary ? 'escribir' : operation;
  const subject = target ? ` ${shortenPath(target)}` : action.endsWith('carpeta') ? '' : ' el archivo';

  return { message: `No se pudo ${action}${subject}: ${text.reason}.`, suggestion: text.suggestion };
}

/** El mensaje de un error para mostrarlo adentro de otro texto, traducido si es de un archivo. */
export function errorText(error: unknown): string {
  return describeFileError(error)?.message ?? (error instanceof Error ? error.message : String(error));
}

/** Leer una carpeta o quedarse sin disco falla sin decir con que archivo: se le suma, para poder nombrarlo. */
export function withFilePath<T>(path: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (isFileSystemError(error) && !error.path) {
      error.path = path;
    }

    throw error;
  }
}
