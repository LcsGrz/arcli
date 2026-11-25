/** El error de WSAA cuando el certificado no tiene la relacion con el servicio. */
export function isNotAuthorized(error: unknown): boolean {
  return error instanceof Error && error.message.includes('notAuthorized');
}

/** Como autorizar un servicio que no es wsfe. */
export const AUTHORIZE_SERVICE_SUGGESTION =
  'Autorizalo igual que wsfe: en testing desde WSASS ("Crear autorización a servicio") y en producción desde el Administrador de Relaciones.';

/** Que paso, sin como autorizarlo: eso va en la sugerencia. */
export function notAuthorizedTitle(service: string, purpose: string): string {
  return `El certificado no está autorizado para el servicio ${service} (${purpose}).`;
}

/** Que paso y como autorizarlo, en un solo texto: los avisos del padron y de la FCE lo citan. */
export function notAuthorizedMessage(service: string, purpose: string): string {
  return `${notAuthorizedTitle(service, purpose)} ${AUTHORIZE_SERVICE_SUGGESTION}`;
}
