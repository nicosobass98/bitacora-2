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
      descripcion: '',
      notas: '',
      estado: 'abierta',
      tipo_horas: 'normal',
      actualizado_en: '2026-07-29T08:00:00+02:00',
    });
    expect((await bd.get('jornadas', 'j-nueva'))?.tipo_horas).toBe('normal');
    bd.close();
  });
});

describe('migración de esquema v2 → v3', () => {
  it('convierte tipo_horas "extra" en "normal": ahora se calcula solo', async () => {
    // Simula una base de la v2, de cuando "extra" todavía era una marca manual.
    const vieja = await openDB(NOMBRE_BD, 2, {
      upgrade(bd) {
        const jornadas = bd.createObjectStore('jornadas', { keyPath: 'id' });
        jornadas.createIndex('por-fecha', 'fecha');
        jornadas.createIndex('por-ubicacion', 'ubicacion_id');
        jornadas.createIndex('por-estado', 'estado');
        bd.createObjectStore('ubicaciones', { keyPath: 'id' });
        bd.createObjectStore('notas', { keyPath: 'id' });
        bd.createObjectStore('outbox', { keyPath: 'id' });
        bd.createObjectStore('ajustes', { keyPath: 'clave' });
        bd.createObjectStore('guardias', { keyPath: 'inicio' });
      },
    });
    await vieja.put('jornadas', {
      id: 'j-extra',
      fecha: '2026-01-10',
      hora_inicio: '2026-01-10T08:00:00+01:00',
      hora_fin: '2026-01-10T20:00:00+01:00',
      ubicacion_id: null,
      motivo: null,
      sistema: null,
      notas: '',
      estado: 'cerrada',
      tipo_horas: 'extra',
      actualizado_en: '2026-01-10T20:00:00+01:00',
    });
    await vieja.put('jornadas', {
      id: 'j-guardia',
      fecha: '2026-01-11',
      hora_inicio: '2026-01-11T02:00:00+01:00',
      hora_fin: '2026-01-11T03:00:00+01:00',
      ubicacion_id: null,
      motivo: null,
      sistema: null,
      notas: '',
      estado: 'cerrada',
      tipo_horas: 'guardia',
      actualizado_en: '2026-01-11T03:00:00+01:00',
    });
    vieja.close();

    const bd = await abrirBD();
    expect(bd.version).toBe(VERSION_BD);
    expect((await bd.get('jornadas', 'j-extra'))?.tipo_horas).toBe('normal');
    // Una salida de guardia no se toca: sigue siendo guardia.
    expect((await bd.get('jornadas', 'j-guardia'))?.tipo_horas).toBe('guardia');
    bd.close();
  });
});

describe('migración de esquema v3 → v4', () => {
  it('copia "notas" a la nueva "descripcion", sin perder lo que ya aparecía en el parte', async () => {
    // Simula una base de la v3, de cuando "notas" era el único sitio donde
    // escribir qué se había hecho — y por tanto lo que salía en el parte.
    const vieja = await openDB(NOMBRE_BD, 3, {
      upgrade(bd) {
        const jornadas = bd.createObjectStore('jornadas', { keyPath: 'id' });
        jornadas.createIndex('por-fecha', 'fecha');
        jornadas.createIndex('por-ubicacion', 'ubicacion_id');
        jornadas.createIndex('por-estado', 'estado');
        bd.createObjectStore('ubicaciones', { keyPath: 'id' });
        bd.createObjectStore('notas', { keyPath: 'id' });
        bd.createObjectStore('outbox', { keyPath: 'id' });
        bd.createObjectStore('ajustes', { keyPath: 'clave' });
        bd.createObjectStore('guardias', { keyPath: 'inicio' });
      },
    });
    await vieja.put('jornadas', {
      id: 'j-vieja',
      fecha: '2026-01-10',
      hora_inicio: '2026-01-10T08:00:00+01:00',
      hora_fin: '2026-01-10T14:00:00+01:00',
      ubicacion_id: null,
      motivo: 'averia',
      sistema: null,
      notas: 'Cambiada la fuente',
      estado: 'cerrada',
      tipo_horas: 'normal',
      actualizado_en: '2026-01-10T14:00:00+01:00',
      // Sin `descripcion`: así se guardaban las jornadas antes de esta versión.
    });
    vieja.close();

    const bd = await abrirBD();
    expect(bd.version).toBe(VERSION_BD);

    const migrada = (await bd.get('jornadas', 'j-vieja')) as Jornada | undefined;
    expect(migrada?.descripcion).toBe('Cambiada la fuente');
    // No se toca: sigue estando disponible tal cual, por si había algo privado mezclado.
    expect(migrada?.notas).toBe('Cambiada la fuente');
    bd.close();
  });
});
