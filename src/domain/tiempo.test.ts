import { describe, expect, it } from 'vitest';
import {
  aFechaISO,
  aInstanteISO,
  desfaseHorario,
  desdeInputDateTime,
  duracionMinutos,
  fechaDe,
  formateaDuracion,
  formateaFechaCorta,
  horaDe,
  horasDesde,
} from './tiempo';

describe('serialización de instantes', () => {
  it('guarda la hora local con su desfase, no en UTC', () => {
    // Un `toISOString()` daría `…T08:03:00.000Z` y perdería el dato de que en el
    // sitio eran las 10:03.
    const fecha = new Date(2026, 6, 29, 10, 3, 0);
    const instante = aInstanteISO(fecha);
    expect(instante.slice(0, 19)).toBe('2026-07-29T10:03:00');
    expect(instante.slice(19)).toMatch(/^(Z|[+-]\d{2}:\d{2})$/);
  });

  it('rellena con ceros meses, días y horas de un dígito', () => {
    expect(aInstanteISO(new Date(2026, 0, 5, 9, 7, 3)).slice(0, 19)).toBe('2026-01-05T09:07:03');
    expect(aFechaISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('formatea el desfase en horas y minutos', () => {
    expect(desfaseHorario({ getTimezoneOffset: () => 0 } as Date)).toBe('Z');
    expect(desfaseHorario({ getTimezoneOffset: () => -120 } as Date)).toBe('+02:00');
    expect(desfaseHorario({ getTimezoneOffset: () => 330 } as Date)).toBe('-05:30');
  });
});

describe('lectura de instantes', () => {
  it('extrae fecha y hora tal y como se registraron', () => {
    expect(fechaDe('2026-03-12T22:40:00+01:00')).toBe('2026-03-12');
    expect(horaDe('2026-03-12T22:40:00+01:00')).toBe('22:40');
    expect(horaDe(null)).toBe('--:--');
  });

  it('calcula duraciones respetando el desfase de cada extremo', () => {
    // Cambio de hora de octubre: 03:00+02:00 → 03:00+01:00 son dos horas, no cero.
    const minutos = duracionMinutos('2026-10-25T02:00:00+02:00', '2026-10-25T03:00:00+01:00');
    expect(minutos).toBe(120);
  });

  it('trata como cero el cierre dentro del mismo minuto de la apertura', () => {
    // El campo de fecha no tiene segundos: cerrar deprisa deja el fin unos
    // segundos por detrás del inicio, y eso no puede bloquear el cierre.
    expect(duracionMinutos('2026-07-29T10:20:35+02:00', '2026-07-29T10:20:00+02:00')).toBe(0);
  });

  it('sigue delatando un fin realmente anterior al inicio', () => {
    expect(duracionMinutos('2026-07-29T14:00:00+02:00', '2026-07-29T10:00:00+02:00')).toBe(-240);
  });

  it('devuelve null cuando falta un extremo', () => {
    expect(duracionMinutos('2026-07-29T10:00:00+02:00', null)).toBeNull();
    expect(duracionMinutos(null, '2026-07-29T10:00:00+02:00')).toBeNull();
  });

  it('cuenta las horas que lleva abierta una jornada', () => {
    const horas = horasDesde('2026-07-29T08:00:00+02:00', new Date('2026-07-29T18:00:00+02:00'));
    expect(horas).toBe(10);
  });
});

describe('entradas de formulario', () => {
  it('añade segundos y desfase al valor de un datetime-local', () => {
    const instante = desdeInputDateTime('2026-07-29T10:03');
    expect(instante?.slice(0, 19)).toBe('2026-07-29T10:03:00');
    expect(instante?.slice(19)).toMatch(/^(Z|[+-]\d{2}:\d{2})$/);
  });

  it('trata el valor vacío como ausencia de fecha', () => {
    expect(desdeInputDateTime('')).toBeNull();
    expect(desdeInputDateTime('no es una fecha')).toBeNull();
  });
});

describe('formato para pantalla', () => {
  it('escribe la duración en horas y minutos', () => {
    expect(formateaDuracion(null)).toBe('—');
    expect(formateaDuracion(35)).toBe('35 min');
    expect(formateaDuracion(120)).toBe('2 h');
    expect(formateaDuracion(260)).toBe('4 h 20 min');
  });

  it('omite el año en curso y lo añade en los demás', () => {
    expect(formateaFechaCorta('2026-03-12', '2026-07-29')).toBe('12 marzo');
    expect(formateaFechaCorta('2025-06-04', '2026-07-29')).toBe('4 junio 2025');
  });
});
