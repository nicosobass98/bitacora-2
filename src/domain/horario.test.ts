import { describe, expect, it } from 'vitest';
import {
  formateaHorasExtra,
  minutosExtraAutomaticos,
  minutosNormales,
  tramosDelDia,
  type HorarioLaboral,
} from './horario';
import { aInstanteISO } from './tiempo';

/**
 * Construye el instante igual que lo haría la app: componentes locales, no un
 * desfase escrito a mano. Si se fijara "+02:00" en el texto, la prueba
 * dependería de que la zona del entorno donde corre vitest coincidiera con
 * Madrid — y en CI no tiene por qué ser así. En el dispositivo real, la
 * jornada capturada y el horario configurado están siempre en la misma zona
 * porque los pone la misma persona en el mismo aparato; aquí se reproduce
 * exactamente eso.
 */
function instante(anio: number, mes: number, dia: number, hora: number, minuto: number): string {
  return aInstanteISO(new Date(anio, mes - 1, dia, hora, minuto));
}

/** El horario real descrito: intensiva en julio-agosto, partido el resto del año. */
const HORARIO: HorarioLaboral = {
  mesInicioVerano: 7,
  mesFinVerano: 8,
  verano: { inicio: '08:00', fin: '14:30' },
  lunesJueves: [
    { inicio: '08:00', fin: '14:00' },
    { inicio: '15:00', fin: '17:30' },
  ],
  viernes: { inicio: '08:00', fin: '14:30' },
};

describe('tramosDelDia', () => {
  it('un lunes fuera de verano tiene turno partido', () => {
    expect(tramosDelDia('2026-05-04', HORARIO)).toEqual(HORARIO.lunesJueves);
  });

  it('un miércoles fuera de verano tiene el mismo turno partido', () => {
    expect(tramosDelDia('2026-05-06', HORARIO)).toEqual(HORARIO.lunesJueves);
  });

  it('un viernes fuera de verano es jornada continua', () => {
    expect(tramosDelDia('2026-05-08', HORARIO)).toEqual([HORARIO.viernes]);
  });

  it('sábado y domingo no tienen horario: cualquier jornada ahí es entera extra', () => {
    expect(tramosDelDia('2026-05-09', HORARIO)).toEqual([]);
    expect(tramosDelDia('2026-05-10', HORARIO)).toEqual([]);
  });

  it('en julio y agosto todos los días laborables usan la jornada intensiva', () => {
    expect(tramosDelDia('2026-07-15', HORARIO)).toEqual([HORARIO.verano]); // miércoles
    expect(tramosDelDia('2026-07-17', HORARIO)).toEqual([HORARIO.verano]); // viernes: manda el verano
  });
});

describe('minutosNormales / minutosExtraAutomaticos', () => {
  it('una jornada dentro del tramo es toda normal', () => {
    const inicio = instante(2026, 5, 4, 8, 0); // lunes
    const fin = instante(2026, 5, 4, 14, 0);
    expect(minutosNormales(inicio, fin, HORARIO)).toBe(360);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(0);
  });

  it('empezar antes de hora cuenta como extra', () => {
    // Lunes: turno de mañana empieza a las 08:00; llega a las 07:30.
    const inicio = instante(2026, 5, 4, 7, 30);
    const fin = instante(2026, 5, 4, 14, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(30);
  });

  it('quedarse después de hora cuenta como extra', () => {
    const inicio = instante(2026, 5, 8, 8, 0); // viernes, sale a las 14:30
    const fin = instante(2026, 5, 8, 16, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(90);
  });

  it('trabajar durante el hueco de un turno partido cuenta ese hueco como extra', () => {
    // Lunes: 13:00 a 15:30 cruza el hueco de la comida (14:00-15:00).
    const inicio = instante(2026, 5, 4, 13, 0);
    const fin = instante(2026, 5, 4, 15, 30);
    expect(minutosNormales(inicio, fin, HORARIO)).toBe(90); // 13-14 y 15-15:30
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(60); // 14:00-15:00
  });

  it('una jornada entera en fin de semana es entera hora extra', () => {
    const inicio = instante(2026, 5, 9, 10, 0);
    const fin = instante(2026, 5, 9, 12, 0);
    expect(minutosNormales(inicio, fin, HORARIO)).toBe(0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(120);
  });

  it('en jornada intensiva de verano, quedarse después de las 14:30 es extra', () => {
    const inicio = instante(2026, 7, 15, 8, 0);
    const fin = instante(2026, 7, 15, 16, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(90);
  });

  it('sin hora de fin no se puede calcular nada: cero, no un valor inventado', () => {
    const inicio = instante(2026, 5, 4, 8, 0);
    expect(minutosNormales(inicio, null, HORARIO)).toBe(0);
    expect(minutosExtraAutomaticos(inicio, null, HORARIO)).toBe(0);
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
