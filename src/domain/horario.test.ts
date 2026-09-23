import { describe, expect, it } from 'vitest';
import {
  formateaHorasExtra,
  minutosExtraAutomaticos,
  minutosRequeridosDelDia,
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

/**
 * El horario real: intensiva en julio-agosto (6:30), 8:30 de lunes a jueves y
 * 6:30 los viernes el resto del año. Los tramos son los mismos de siempre —
 * es como el usuario piensa su jornada—, pero lo único que cuenta ahora es su
 * duración total, no las horas concretas de cada uno.
 */
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

describe('minutosRequeridosDelDia', () => {
  it('sale de sumar la duración de los tramos, no de sus horas concretas', () => {
    expect(minutosRequeridosDelDia('2026-05-04', HORARIO)).toBe(510); // 8:30, lunes
    expect(minutosRequeridosDelDia('2026-05-08', HORARIO)).toBe(390); // 6:30, viernes
    expect(minutosRequeridosDelDia('2026-07-15', HORARIO)).toBe(390); // 6:30, verano
    expect(minutosRequeridosDelDia('2026-05-09', HORARIO)).toBe(0); // sábado
  });
});

describe('minutosExtraAutomaticos', () => {
  it('trabajar menos del total exigido no genera hora extra, ni la resta', () => {
    const inicio = instante(2026, 5, 4, 8, 0); // lunes, 8:30 exigidas
    const fin = instante(2026, 5, 4, 14, 0); // 6h trabajadas
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(0);
  });

  it('no importa la hora de entrada ni de salida, solo el total del día', () => {
    // Lunes, empezando y acabando fuera de los tramos configurados (9:00 en
    // vez de 8:00, 17:00 en vez de 17:30): 8h trabajadas, menos de las 8:30
    // exigidas, así que sigue sin haber hora extra.
    const inicio = instante(2026, 5, 4, 9, 0);
    const fin = instante(2026, 5, 4, 17, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(0);
  });

  it('trabajar sin descanso en el hueco del turno partido no genera hora extra por sí solo', () => {
    // Lunes 08:00-16:30, sin parar a comer: 8:30 en total, justo lo exigido.
    // Antes, cualquier minuto en el hueco 14:00-15:00 contaba como extra sin
    // serlo — este es el caso que lo prueba.
    const inicio = instante(2026, 5, 4, 8, 0);
    const fin = instante(2026, 5, 4, 16, 30);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(0);
  });

  it('lo que pase del total exigido sí es hora extra, aunque sea sin descanso', () => {
    // Lunes 08:00-17:00: 9h en total, media hora por encima de las 8:30.
    const inicio = instante(2026, 5, 4, 8, 0);
    const fin = instante(2026, 5, 4, 17, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(30);
  });

  it('quedarse después de hora cuenta como extra', () => {
    const inicio = instante(2026, 5, 8, 8, 0); // viernes, 6:30 exigidas
    const fin = instante(2026, 5, 8, 16, 0); // 8h trabajadas
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(90);
  });

  it('una jornada entera en fin de semana es entera hora extra', () => {
    const inicio = instante(2026, 5, 9, 10, 0);
    const fin = instante(2026, 5, 9, 12, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(120);
  });

  it('en jornada intensiva de verano, pasarse de las 6:30 exigidas es extra', () => {
    const inicio = instante(2026, 7, 15, 8, 0);
    const fin = instante(2026, 7, 15, 16, 0);
    expect(minutosExtraAutomaticos(inicio, fin, HORARIO)).toBe(90);
  });

  it('sin hora de fin no se puede calcular nada: cero, no un valor inventado', () => {
    const inicio = instante(2026, 5, 4, 8, 0);
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
