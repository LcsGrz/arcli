/** El error de WSAA cuando el certificado no tiene la relacion con el servicio. */
export function isNotAuthorized(error: unknown): boolean {
  return error instanceof Error && error.message.includes('notAuthorized');
}

/** El mismo texto para los servicios que no son wsfe: que paso y como autorizarlo. */
export function notAuthorizedMessage(service: string, purpose: string): string {
  return `El certificado no está autorizado para el servicio ${service} (${purpose}). Autorizalo igual que wsfe: en testing desde WSASS ("Crear autorización a servicio") y en producción desde el Administrador de Relaciones.`;
}
