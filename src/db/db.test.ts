import { beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { NOMBRE_BD, VERSION_BD, _reiniciaConexion, abrirBD } from './db';
import type { Jornada } from '../domain/tipos';

/**
 * La migración a la v2 (§ semanas de guardia y horas extra) tiene que
 * respetar los datos que ya existían en el móvil de un usuario real: una
 * jornada sin `tipo_horas` no puede desaparecer ni quedar en un estado que
 * viole la lista cerrada.
 */
async function borraBaseDePrueba(): Promise<void> {
  _reiniciaConexion();
  await indexedDB.deleteDatabase(NOMBRE_BD);
}

beforeEach(borraBaseDePrueba);

describe('migración de esquema v1 → v2', () => {
  it('conserva las jornadas antiguas y les añade tipo_horas: normal', async () => {
    // Simula una base dejada por una versión anterior de la app: sin
    // `tipo_horas` en las jornadas y sin el almacén `guardias`.
    const vieja = await openDB(NOMBRE_BD, 1, {
      upgrade(bd) {
        const jornadas = bd.createObjectStore('jornadas', { keyPath: 'id' });
        jornadas.createIndex('por-fecha', 'fecha');
        jornadas.createIndex('por-ubicacion', 'ubicacion_id');
        jornadas.createIndex('por-estado', 'estado');
        bd.createObjectStore('ubicaciones', { keyPath: 'id' });
        bd.createObjectStore('notas', { keyPath: 'id' });
        bd.createObjectStore('outbox', { keyPath: 'id' });
        bd.createObjectStore('ajustes', { keyPath: 'clave' });
      },
    });
    const antigua = {
      id: 'j-antigua',
      fecha: '2026-01-10',
      hora_inicio: '2026-01-10T08:00:00+01:00',
      hora_fin: '2026-01-10T14:00:00+01:00',
      ubicacion_id: null,
      motivo: 'mantenimiento',
      sistema: null,
      notas: 'de antes de la migración',
      estado: 'cerrada',
      actualizado_en: '2026-01-10T14:00:00+01:00',
      // Sin `tipo_horas`: así se guardaban las jornadas antes de esta versión.
    };
    await vieja.put('jornadas', antigua);
    vieja.close();

    const bd = await abrirBD();
    expect(bd.version).toBe(VERSION_BD);

    const migrada = (await bd.get('jornadas', 'j-antigua')) as Jornada | undefined;
    expect(migrada?.notas).toBe('de antes de la migración');
    expect(migrada?.tipo_horas).toBe('normal');

    // El almacén nuevo existe y empieza vacío, no en un estado inconsistente.
    expect(await bd.getAll('guardias')).toEqual([]);
    bd.close();
  });

  it('una base recién creada nace ya con tipo_horas en sus jornadas', async () => {
    const bd = await abrirBD();
    await bd.put('jornadas', {
      id: 'j-nueva',
      fecha: '2026-07-29',
      hora_inicio: '2026-07-29T08:00:00+02:00',
      hora_fin: null,
      ubicacion_id: null,
      motivo: null,
      sistema: null,
      notas: '',
      estado: 'abierta',
      tipo_horas: 'normal',
      actualizado_en: '2026-07-29T08:00:00+02:00',
    });
    expect((await bd.get('jornadas', 'j-nueva'))?.tipo_horas).toBe('normal');
    bd.close();
  });
});
