/**
 * Lo que el núcleo lee de los archivos que indica quien usa el CLI (certificados, claves, logo, navegador). El núcleo
 * no importa `node:fs`: lo recibe como dependencia y la app pasa el adaptador de `src/services/files`.
 */
export interface LocalFiles {
  exists(path: string): boolean;
  /** El contenido en UTF-8. Si no se puede leer, tira el error del sistema con la ruta del archivo. */
  readText(path: string): string;
}
