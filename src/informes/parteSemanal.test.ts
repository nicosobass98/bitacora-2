import { describe, expect, it } from 'vitest';
import { construyeFilas } from './parteSemanal';
import type { Jornada, Ubicacion } from '../domain/tipos';

function jornada(cambios: Partial<Jornada>): Jornada {
  return {
    id: crypto.randomUUID(),
    fecha: '2026-05-04',
    hora_inicio: '2026-05-04T08:00:00+02:00',
    hora_fin: '2026-05-04T15:30:00+02:00',
    ubicacion_id: null,
    motivo: null,
    sistema: null,
    notas: '',
    estado: 'cerrada',
    actualizado_en: '2026-05-04T15:30:00+02:00',
    ...cambios,
  };
}

function ubicacion(cambios: Partial<Ubicacion>): Ubicacion {
  return {
    id: crypto.randomUUID(),
    nombre: 'Blangarma',
    direccion: '',
    cliente: 'Blangarma S.L.',
    notas_acceso: '',
    actualizado_en: '2026-05-04T00:00:00+02:00',
    usado_en: null,
    ...cambios,
  };
}

describe('construyeFilas', () => {
  it('escribe día-mes solo la primera vez, y día suelto mientras no cambie el mes', () => {
    const sitio = ubicacion({});
    const filas = construyeFilas(
      [
        jornada({ fecha: '2026-05-04' }),
        jornada({ fecha: '2026-05-05' }),
        jornada({ fecha: '2026-06-01' }),
      ],
      new Map([[sitio.id, sitio]]),
    );
    expect(filas.map((f) => f.fecha)).toEqual(['4-5', '5', '1-6']);
  });

  it('resuelve el sitio a nombre y cliente, no dejando el id en el parte', () => {
    const sitio = ubicacion({ nombre: 'nave 3 polígono', cliente: 'Cliente S.L.' });
    const [fila] = construyeFilas([jornada({ ubicacion_id: sitio.id })], new Map([[sitio.id, sitio]]));
    expect(fila?.obra).toBe('nave 3 polígono');
    expect(fila?.clienteProyecto).toBe('Cliente S.L.');
  });

  it('marca "Sin asignar" una jornada sin ubicación, en vez de dejarlo en blanco sin explicar', () => {
    const [fila] = construyeFilas([jornada({ ubicacion_id: null })], new Map());
    expect(fila?.obra).toBe('Sin asignar');
  });

  it('combina motivo y notas en la descripción, sin inventar nada si faltan', () => {
    const [conAmbos] = construyeFilas(
      [jornada({ motivo: 'averia', notas: 'Cambiada la fuente' })],
      new Map(),
    );
    expect(conAmbos?.trabajos).toBe('Avería — Cambiada la fuente');

    const [sinNada] = construyeFilas([jornada({ motivo: null, notas: '' })], new Map());
    expect(sinNada?.trabajos).toBe('—');
  });

  it('una jornada sin cerrar muestra la salida en blanco, no una hora inventada', () => {
    const [fila] = construyeFilas([jornada({ hora_fin: null, estado: 'abierta' })], new Map());
    expect(fila?.salida).toBe('--:--');
  });
});
