/** Sitio de documentacion. Las demas URLs de esta lista son paginas suyas. */
export const DOCS_SITE_URL = 'https://arcli.com.ar';

/**
 * Guia para sacar el certificado de ARCA. Es la de testing, por donde se empieza; al final lleva a la de produccion.
 * Tiene la seccion "Que servicios autorizar".
 */
export const CERTIFICATE_GUIDE_URL = `${DOCS_SITE_URL}/empezar/certificado-testing/`;

/** Seccion "Renovar el certificado" de la guia de produccion. */
export const PRODUCTION_RENEWAL_GUIDE_URL = `${DOCS_SITE_URL}/empezar/certificado-produccion/#renovar-el-certificado`;

/**
 * Adonde mandar para renovar el certificado de un entorno: en produccion, su seccion de renovar; en testing, la guia
 * de siempre (renovarlo es sacarlo de nuevo).
 */
export function certificateRenewalGuideUrl(environment: 'produccion' | 'testing'): string {
  return environment === 'produccion' ? PRODUCTION_RENEWAL_GUIDE_URL : CERTIFICATE_GUIDE_URL;
}

/** El certificado propio de exportacion: no se renueva con `arcli certificado`, se carga en la config. */
export const EXPORT_CERTIFICATE_GUIDE_URL = `${DOCS_SITE_URL}/referencia/configuracion/#certificados-de-exportación-wsfex`;

/** Seccion de la guia completa de produccion que explica como ver o crear un punto de venta para web service. */
export const POINT_OF_SALE_GUIDE_URL = `${DOCS_SITE_URL}/empezar/certificado-produccion-completo/#punto-de-venta-para-web-service`;

/** Problemas frecuentes, con la tabla de rechazos de ARCA por codigo. */
export const TROUBLESHOOTING_URL = `${DOCS_SITE_URL}/ayuda/problemas-frecuentes/`;

/** Issues del repo, para avisar de un problema. */
export const ISSUES_URL = 'https://github.com/LcsGrz/arcli/issues';

/** Novedades de cada version (el CHANGELOG en el sitio). */
export const CHANGELOG_PAGE_URL = `${DOCS_SITE_URL}/ayuda/novedades/`;
