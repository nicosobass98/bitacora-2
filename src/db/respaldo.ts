import { abrirBD } from './db';
import { publica } from './bus';
import { encola } from './outbox';
import { ahora } from '../domain/tiempo';
import { COLECCIONES, type Coleccion, type Jornada, type Nota, type Ubicacion } from '../domain/tipos';

/**
 * Copia de seguridad en un fichero.
 *
 * La especificación da por hecho que la copia vive en Google Sheets, pero eso
 * exige cuenta, alta en Google Cloud y red. Esto es la red de seguridad que
 * funciona sin nada de eso, y es lo único que permite mover los datos entre dos
 * almacenes del mismo dispositivo — en iOS, una web abierta en Safari y la
 * misma web añadida a la pantalla de inicio no comparten IndexedDB.
 */

export const VERSION_RESPALDO = 1;

export interface Respaldo {
  version: number;
  exportado_en: string;
  jornadas: Jornada[];
  ubicaciones: Ubicacion[];
  notas: Nota[];
}

export interface ResumenColeccion {
  nuevos: number;
  actualizados: number;
  omitidos: number;
}

export type ResumenImportacion = Record<Coleccion, ResumenColeccion>;

export class ErrorRespaldo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRespaldo';
  }
}

/**
 * Vuelca las tres colecciones. Los ajustes se quedan fuera a propósito: el id
 * de la hoja de cálculo no debe viajar a otro dispositivo, o dos móviles
 * acabarían escribiendo en la misma hoja pisándose las filas.
 */
export async function construyeRespaldo(): Promise<Respaldo> {
  const bd = await abrirBD();
  const [jornadas, ubicaciones, notas] = await Promise.all([
    bd.getAll('jornadas'),
    bd.getAll('ubicaciones'),
    bd.getAll('notas'),
  ]);
  return { version: VERSION_RESPALDO, exportado_en: ahora(), jornadas, ubicaciones, notas };
}

export function serializaRespaldo(respaldo: Respaldo): string {
  return JSON.stringify(respaldo, null, 2);
}

export function nombreRespaldo(respaldo: Respaldo): string {
  return `bitacora-${respaldo.exportado_en.slice(0, 10)}.json`;
}

function esRegistro(valor: unknown): valor is { id: string; actualizado_en: string } {
  if (typeof valor !== 'object' || valor === null) return false;
  const registro = valor as Record<string, unknown>;
  return typeof registro.id === 'string' && registro.id.length > 0;
}

/**
 * Valida antes de tocar nada. Un fichero a medio entender no se aplica «lo que
 * se pueda»: se rechaza entero y se dice por qué. Nada falla en silencio (§7).
 */
export function leeRespaldo(texto: string): Respaldo {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErrorRespaldo('El fichero no es un JSON válido.');
  }
  if (typeof bruto !== 'object' || bruto === null) {
    throw new ErrorRespaldo('El fichero no contiene una copia de Bitácora.');
  }

  const datos = bruto as Record<string, unknown>;
  if (datos.version !== VERSION_RESPALDO) {
    throw new ErrorRespaldo(
      `Copia de versión ${String(datos.version)}; esta app entiende la ${VERSION_RESPALDO}.`,
    );
  }

  for (const coleccion of COLECCIONES) {
    const valor = datos[coleccion];
    if (!Array.isArray(valor)) {
      throw new ErrorRespaldo(`Falta la lista de ${coleccion} o no es una lista.`);
    }
    if (!valor.every(esRegistro)) {
      throw new ErrorRespaldo(`Hay ${coleccion} sin identificador. La copia está corrupta.`);
    }
  }

  return {
    version: VERSION_RESPALDO,
    exportado_en: typeof datos.exportado_en === 'string' ? datos.exportado_en : ahora(),
    jornadas: datos.jornadas as Jornada[],
    ubicaciones: datos.ubicaciones as Ubicacion[],
    notas: datos.notas as Nota[],
  };
}

function vacio(): ResumenColeccion {
  return { nuevos: 0, actualizados: 0, omitidos: 0 };
}

/**
 * Mezcla, no sustituye: importar nunca borra lo que ya hay.
 *
 * Ante el mismo `id` gana el `actualizado_en` más reciente. Como los ids son
 * UUID generados en el móvil, importar dos veces el mismo fichero no duplica
 * nada — es la misma idempotencia en la que se apoya la cola outbox (§4).
 */
export async function aplicaRespaldo(respaldo: Respaldo): Promise<ResumenImportacion> {
  const bd = await abrirBD();
  const resumen: ResumenImportacion = {
    jornadas: vacio(),
    ubicaciones: vacio(),
    notas: vacio(),
  };
  const porEncolar: { coleccion: Coleccion; datos: Jornada | Ubicacion | Nota }[] = [];

  for (const coleccion of COLECCIONES) {
    const entrantes = respaldo[coleccion] as (Jornada | Ubicacion | Nota)[];
    const tx = bd.transaction(coleccion, 'readwrite');

    for (const entrante of entrantes) {
      const existente = await tx.store.get(entrante.id);
      if (existente) {
        const masNuevo = (entrante.actualizado_en ?? '') > (existente.actualizado_en ?? '');
        if (!masNuevo) {
          resumen[coleccion].omitidos++;
          continue;
        }
        resumen[coleccion].actualizados++;
      } else {
        resumen[coleccion].nuevos++;
      }
      await tx.store.put(entrante as never);
      porEncolar.push({ coleccion, datos: entrante });
    }

    await tx.done;
  }

  publica('jornadas', 'ubicaciones', 'notas');

  // Lo importado también tiene que llegar a la hoja: si se restaura en un móvil
  // nuevo, la copia de Drive no puede quedarse a medias. Se encola después de
  // cerrar las transacciones, nunca dentro.
  for (const { coleccion, datos } of porEncolar) {
    // Una jornada todavía abierta no se encola: se sincroniza al cerrarla (§4).
    if (coleccion === 'jornadas' && (datos as Jornada).estado === 'abierta') continue;
    await encola(coleccion, datos);
  }

  return resumen;
}

export function totalRegistros(respaldo: Respaldo): number {
  return respaldo.jornadas.length + respaldo.ubicaciones.length + respaldo.notas.length;
}

/**
 * Entrega el fichero. Se intenta compartir primero porque en iPhone es la vía
 * que ofrece «Guardar en Archivos»; si no hay soporte, se descarga.
 */
export async function entregaRespaldo(respaldo: Respaldo): Promise<void> {
  const contenido = serializaRespaldo(respaldo);
  const nombre = nombreRespaldo(respaldo);
  const blob = new Blob([contenido], { type: 'application/json' });

  if (typeof navigator !== 'undefined' && 'canShare' in navigator) {
    const adjunto = new File([blob], nombre, { type: 'application/json' });
    if (navigator.canShare?.({ files: [adjunto] })) {
      try {
        await navigator.share({ files: [adjunto], title: 'Copia de Bitácora' });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
