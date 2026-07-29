import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ElementoOutbox, Jornada, Nota, Ubicacion } from '../domain/tipos';

/**
 * IndexedDB es la fuente de verdad (§2). Drive es solo la copia.
 *
 * Los índices no son opcionales: las dos búsquedas de §5.6 son la misma tabla
 * leída por dos índices distintos, y tienen que responder en un sótano sin
 * cobertura.
 */

export const NOMBRE_BD = 'bitacora';
export const VERSION_BD = 1;

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
}

export type BD = IDBPDatabase<EsquemaBitacora>;

let promesaBD: Promise<BD> | null = null;

export function abrirBD(): Promise<BD> {
  if (!promesaBD) {
    promesaBD = openDB<EsquemaBitacora>(NOMBRE_BD, VERSION_BD, {
      upgrade(bd, versionAnterior) {
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
      },
    });
  }
  return promesaBD;
}

/** Solo para las pruebas: fuerza reabrir la base en la siguiente llamada. */
export function _reiniciaConexion(): void {
  promesaBD = null;
}
