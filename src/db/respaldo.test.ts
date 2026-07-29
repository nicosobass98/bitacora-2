import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBD } from './db';
import {
  ErrorRespaldo,
  VERSION_RESPALDO,
  aplicaRespaldo,
  construyeRespaldo,
  leeRespaldo,
  nombreRespaldo,
  serializaRespaldo,
  totalRegistros,
} from './respaldo';
import {
  abreJornada,
  cierraJornada,
  creaNota,
  creaUbicacion,
  obtenJornada,
  todasLasJornadas,
  todasLasNotas,
  todasLasUbicaciones,
} from './repos';
import { todosLosElementos } from './outbox';

async function limpia() {
  const bd = await abrirBD();
  for (const almacen of ['jornadas', 'ubicaciones', 'notas', 'outbox', 'ajustes'] as const) {
    await bd.clear(almacen);
  }
}

/** Deja una base con un sitio, una jornada cerrada y una nota. */
async function siembra() {
  const sitio = await creaUbicacion({ nombre: 'nave 3 polígono', notas_acceso: 'Aparcar detrás' });
  const jornada = await abreJornada({ ubicacion_id: sitio.id, motivo: 'averia' });
  const cerrada = await cierraJornada(jornada.id, { notas: 'Cambiada la fuente' });
  const nota = await creaNota({ texto: 'Falta tubo de 25' });
  return { sitio, jornada: cerrada, nota };
}

beforeEach(limpia);

describe('exportar', () => {
  it('vuelca las tres colecciones', async () => {
    await siembra();
    const respaldo = await construyeRespaldo();

    expect(respaldo.version).toBe(VERSION_RESPALDO);
    expect(respaldo.jornadas).toHaveLength(1);
    expect(respaldo.ubicaciones).toHaveLength(1);
    expect(respaldo.notas).toHaveLength(1);
    expect(totalRegistros(respaldo)).toBe(3);
  });

  it('no se lleva los ajustes: el id de la hoja no debe viajar a otro móvil', async () => {
    await siembra();
    const respaldo = await construyeRespaldo();
    expect(Object.keys(respaldo).sort()).toEqual([
      'exportado_en',
      'jornadas',
      'notas',
      'ubicaciones',
      'version',
    ]);
  });

  it('nombra el fichero con la fecha de la copia', async () => {
    const respaldo = await construyeRespaldo();
    expect(nombreRespaldo(respaldo)).toMatch(/^bitacora-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('validación al importar', () => {
  it('rechaza lo que no es JSON', () => {
    expect(() => leeRespaldo('esto no es json')).toThrow(ErrorRespaldo);
  });

  it('rechaza una versión que no entiende, en vez de adivinar', () => {
    const futuro = JSON.stringify({ version: 99, jornadas: [], ubicaciones: [], notas: [] });
    expect(() => leeRespaldo(futuro)).toThrow(/versión 99/);
  });

  it('rechaza una copia a la que le falta una colección', () => {
    const incompleto = JSON.stringify({ version: 1, jornadas: [], ubicaciones: [] });
    expect(() => leeRespaldo(incompleto)).toThrow(/notas/);
  });

  it('rechaza registros sin identificador: sin id no hay idempotencia', () => {
    const corrupto = JSON.stringify({
      version: 1,
      jornadas: [{ fecha: '2026-07-29' }],
      ubicaciones: [],
      notas: [],
    });
    expect(() => leeRespaldo(corrupto)).toThrow(/identificador/);
  });
});

describe('importar', () => {
  it('da la vuelta completa: exportar, borrar todo y restaurar', async () => {
    const { sitio, jornada, nota } = await siembra();
    const texto = serializaRespaldo(await construyeRespaldo());

    await limpia();
    expect(await todasLasJornadas()).toHaveLength(0);

    const resumen = await aplicaRespaldo(leeRespaldo(texto));

    expect(resumen.jornadas.nuevos).toBe(1);
    expect(resumen.ubicaciones.nuevos).toBe(1);
    expect(resumen.notas.nuevos).toBe(1);

    const restaurada = await obtenJornada(jornada.id);
    expect(restaurada?.notas).toBe('Cambiada la fuente');
    expect(restaurada?.ubicacion_id).toBe(sitio.id);
    expect((await todasLasUbicaciones())[0]?.notas_acceso).toBe('Aparcar detrás');
    expect((await todasLasNotas())[0]?.texto).toBe(nota.texto);
  });

  it('importar dos veces el mismo fichero no duplica nada', async () => {
    await siembra();
    const texto = serializaRespaldo(await construyeRespaldo());

    await aplicaRespaldo(leeRespaldo(texto));
    const segunda = await aplicaRespaldo(leeRespaldo(texto));

    expect(await todasLasJornadas()).toHaveLength(1);
    expect(segunda.jornadas.nuevos).toBe(0);
    expect(segunda.jornadas.omitidos).toBe(1);
  });

  it('mezcla en vez de sustituir: lo que ya había no se pierde', async () => {
    // Copia con solo la jornada A.
    const primera = await siembra();
    const texto = serializaRespaldo(await construyeRespaldo());

    // En el otro almacén hay una jornada B distinta.
    await limpia();
    const otroSitio = await creaUbicacion({ nombre: 'otro sitio' });
    const otraJornada = await abreJornada({ ubicacion_id: otroSitio.id, motivo: 'revision' });
    await cierraJornada(otraJornada.id);

    await aplicaRespaldo(leeRespaldo(texto));

    const ids = (await todasLasJornadas()).map((j) => j.id).sort();
    expect(ids).toEqual([primera.jornada.id, otraJornada.id].sort());
  });

  it('ante el mismo id gana la versión más reciente', async () => {
    const { jornada } = await siembra();
    const respaldo = await construyeRespaldo();

    // La copia trae el registro con una edición posterior.
    respaldo.jornadas = [
      { ...jornada, notas: 'versión de la copia', actualizado_en: '2099-01-01T00:00:00+01:00' },
    ];
    await aplicaRespaldo(respaldo);
    expect((await obtenJornada(jornada.id))?.notas).toBe('versión de la copia');

    // Y al revés: una copia vieja no pisa lo que hay.
    respaldo.jornadas = [
      { ...jornada, notas: 'versión antigua', actualizado_en: '2000-01-01T00:00:00+01:00' },
    ];
    const resumen = await aplicaRespaldo(respaldo);
    expect(resumen.jornadas.omitidos).toBe(1);
    expect((await obtenJornada(jornada.id))?.notas).toBe('versión de la copia');
  });

  it('encola lo importado para que la hoja no se quede a medias', async () => {
    await siembra();
    const texto = serializaRespaldo(await construyeRespaldo());

    await limpia();
    await aplicaRespaldo(leeRespaldo(texto));

    const cola = await todosLosElementos();
    expect(cola.map((e) => e.coleccion).sort()).toEqual(['jornadas', 'notas', 'ubicaciones']);
  });

  it('no encola una jornada abierta: esa se sincroniza al cerrarla', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    await abreJornada({ ubicacion_id: sitio.id, motivo: 'averia' });
    const texto = serializaRespaldo(await construyeRespaldo());

    await limpia();
    await aplicaRespaldo(leeRespaldo(texto));

    const cola = await todosLosElementos();
    expect(cola.some((e) => e.coleccion === 'jornadas')).toBe(false);
    expect(await todasLasJornadas()).toHaveLength(1);
  });
});
