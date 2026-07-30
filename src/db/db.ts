import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ElementoOutbox, Jornada, Nota, SemanaGuardia, Ubicacion } from '../domain/tipos';

/**
 * IndexedDB es la fuente de verdad (§2). Drive es solo la copia.
 *
 * Los índices no son opcionales: las dos búsquedas de §5.6 son la misma tabla
 * leída por dos índices distintos, y tienen que responder en un sótano sin
 * cobertura.
 */

export const NOMBRE_BD = 'bitacora';
export const VERSION_BD = 3;

interface EsquemaBitacora extends DBSchema {
  jornadas: {
    key: string;
    value: Jornada;
    indexes: {
      /** Fecha → sitio. */
      'por-fecha': string;
      /** Sitio → fechas. */
      'por-ubicacion': string;
      /** Contador de jornadas por completar y jornada abierta actual. */
      'por-estado': string;
    };
  };
  ubicaciones: {
    key: string;
    value: Ubicacion;
    indexes: { 'por-nombre': string };
  };
  notas: {
    key: string;
    value: Nota;
    indexes: {
      'por-ubicacion': string;
      'por-jornada': string;
      'por-aviso': string;
      'por-estado': string;
    };
  };
  outbox: {
    key: string;
    value: ElementoOutbox;
    indexes: { 'por-estado': string; 'por-entidad': [string, string] };
  };
  ajustes: {
    key: string;
    value: { clave: string; valor: unknown };
  };
  guardias: {
    key: string;
    value: SemanaGuardia;
  };
}

export type BD = IDBPDatabase<EsquemaBitacora>;

let promesaBD: Promise<BD> | null = null;

export function abrirBD(): Promise<BD> {
  if (!promesaBD) {
    promesaBD = openDB<EsquemaBitacora>(NOMBRE_BD, VERSION_BD, {
      async upgrade(bd, versionAnterior, _versionNueva, tx) {
        if (versionAnterior < 1) {
          const jornadas = bd.createObjectStore('jornadas', { keyPath: 'id' });
          jornadas.createIndex('por-fecha', 'fecha');
          jornadas.createIndex('por-ubicacion', 'ubicacion_id');
          jornadas.createIndex('por-estado', 'estado');

          const ubicaciones = bd.createObjectStore('ubicaciones', { keyPath: 'id' });
          ubicaciones.createIndex('por-nombre', 'nombre');

          const notas = bd.createObjectStore('notas', { keyPath: 'id' });
          notas.createIndex('por-ubicacion', 'ubicacion_id');
          notas.createIndex('por-jornada', 'jornada_id');
          notas.createIndex('por-aviso', 'fecha_aviso');
          notas.createIndex('por-estado', 'estado');

          const outbox = bd.createObjectStore('outbox', { keyPath: 'id' });
          outbox.createIndex('por-estado', 'estado');
          outbox.createIndex('por-entidad', ['coleccion', 'entidad_id'], { unique: true });

          bd.createObjectStore('ajustes', { keyPath: 'clave' });
        }
        if (versionAnterior < 2) {
          bd.createObjectStore('guardias', { keyPath: 'inicio' });

          // Las jornadas de antes de este esquema no tienen `tipo_horas`. Se
          // rellenan como 'normal' explícitamente: dejarlo en `undefined`
          // metería un valor fuera de la lista cerrada en la primera lectura.
          const almacen = tx.objectStore('jornadas');
          let cursor = await almacen.openCursor();
          while (cursor) {
            const valor = cursor.value as unknown as Record<string, unknown>;
            if (!('tipo_horas' in valor)) {
              await cursor.update({ ...valor, tipo_horas: 'normal' } as Jornada);
            }
            cursor = await cursor.continue();
          }
        }
        if (versionAnterior < 3) {
          // `tipo_horas: 'extra'` desaparece: a partir de esta versión, las
          // horas extra de una jornada normal se calculan solas comparándola
          // con el horario habitual (`domain/horario.ts`), en vez de marcarse
          // a mano. Lo que estaba marcado como 'extra' vuelve a 'normal' — el
          // cálculo automático es más preciso que la marca manual que
          // sustituye, no una pérdida de información.
          const almacen = tx.objectStore('jornadas');
          let cursor = await almacen.openCursor();
          while (cursor) {
            const valor = cursor.value as unknown as { tipo_horas?: string };
            if (valor.tipo_horas === 'extra') {
              await cursor.update({ ...cursor.value, tipo_horas: 'normal' } as Jornada);
            }
            cursor = await cursor.continue();
          }
        }
      },
    });
  }
  return promesaBD;
}

/** Solo para las pruebas: fuerza reabrir la base en la siguiente llamada. */
export function _reiniciaConexion(): void {
  promesaBD = null;
}
