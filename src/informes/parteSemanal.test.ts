import { describe, expect, it } from 'vitest';
import { construyeFilas, formateaHorasExtra } from './parteSemanal';
import type { Jornada, Ubicacion } from '../domain/tipos';

const MINUTOS_MINIMOS_GUARDIA = 180;

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
    tipo_horas: 'normal',
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
      MINUTOS_MINIMOS_GUARDIA,
    );
    expect(filas.map((f) => f.fecha)).toEqual(['4-5', '5', '1-6']);
  });

  it('resuelve el sitio a nombre y cliente, no dejando el id en el parte', () => {
    const sitio = ubicacion({ nombre: 'nave 3 polígono', cliente: 'Cliente S.L.' });
    const [fila] = construyeFilas(
      [jornada({ ubicacion_id: sitio.id })],
      new Map([[sitio.id, sitio]]),
      MINUTOS_MINIMOS_GUARDIA,
    );
    expect(fila?.obra).toBe('nave 3 polígono');
    expect(fila?.clienteProyecto).toBe('Cliente S.L.');
  });

  it('marca "Sin asignar" una jornada sin ubicación, en vez de dejarlo en blanco sin explicar', () => {
    const [fila] = construyeFilas([jornada({ ubicacion_id: null })], new Map(), MINUTOS_MINIMOS_GUARDIA);
    expect(fila?.obra).toBe('Sin asignar');
  });

  it('combina motivo y notas en la descripción, sin inventar nada si faltan', () => {
    const [conAmbos] = construyeFilas(
      [jornada({ motivo: 'averia', notas: 'Cambiada la fuente' })],
      new Map(),
      MINUTOS_MINIMOS_GUARDIA,
    );
    expect(conAmbos?.trabajos).toBe('Avería — Cambiada la fuente');

    const [sinNada] = construyeFilas(
      [jornada({ motivo: null, notas: '' })],
      new Map(),
      MINUTOS_MINIMOS_GUARDIA,
    );
    expect(sinNada?.trabajos).toBe('—');
  });

  it('una jornada sin cerrar muestra la salida en blanco, no una hora inventada', () => {
    const [fila] = construyeFilas(
      [jornada({ hora_fin: null, estado: 'abierta' })],
      new Map(),
      MINUTOS_MINIMOS_GUARDIA,
    );
    expect(fila?.salida).toBe('--:--');
  });

  it('una jornada normal no lleva nada en la columna de horas extra', () => {
    const [fila] = construyeFilas([jornada({ tipo_horas: 'normal' })], new Map(), MINUTOS_MINIMOS_GUARDIA);
    expect(fila?.horasExtra).toBe('');
  });

  it('una hora extra cuenta la duración real de la jornada', () => {
    // 08:00 a 15:30 = 7h30.
    const [fila] = construyeFilas([jornada({ tipo_horas: 'extra' })], new Map(), MINUTOS_MINIMOS_GUARDIA);
    expect(fila?.horasExtra).toBe('7:30');
  });

  it('una salida de guardia cuenta como mínimo lo que fije el convenio', () => {
    const corta = jornada({
      tipo_horas: 'guardia',
      hora_inicio: '2026-05-04T02:00:00+02:00',
      hora_fin: '2026-05-04T02:45:00+02:00', // 45 minutos reales
    });
    const [fila] = construyeFilas([corta], new Map(), MINUTOS_MINIMOS_GUARDIA);
    expect(fila?.horasExtra).toBe('3'); // el mínimo de 180 min, no los 45 reales

    // La hora de entrada y salida sigue siendo la real: solo cambia el cómputo.
    expect(fila?.entrada).toBe('02:00');
    expect(fila?.salida).toBe('02:45');
  });

  it('una salida de guardia más larga que el mínimo cuenta la duración real', () => {
    const larga = jornada({
      tipo_horas: 'guardia',
      hora_inicio: '2026-05-04T02:00:00+02:00',
      hora_fin: '2026-05-04T06:00:00+02:00', // 4 horas reales
    });
    const [fila] = construyeFilas([larga], new Map(), MINUTOS_MINIMOS_GUARDIA);
    expect(fila?.horasExtra).toBe('4');
  });

  it('antepone «Guardia» a la descripción de una salida de guardia', () => {
    const [fila] = construyeFilas(
      [jornada({ tipo_horas: 'guardia', motivo: 'averia', notas: 'Rearme de central' })],
      new Map(),
      MINUTOS_MINIMOS_GUARDIA,
    );
    expect(fila?.trabajos).toBe('Guardia — Avería — Rearme de central');
  });
});

describe('formateaHorasExtra', () => {
  it('omite los minutos cuando son una hora exacta', () => {
    expect(formateaHorasExtra(60)).toBe('1');
    expect(formateaHorasExtra(180)).toBe('3');
  });

  it('escribe horas y minutos con dos dígitos', () => {
    expect(formateaHorasExtra(90)).toBe('1:30');
    expect(formateaHorasExtra(45)).toBe('0:45');
    expect(formateaHorasExtra(65)).toBe('1:05');
  });
});
