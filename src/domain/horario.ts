import { aFechaLocal, duracionMinutos, fechaDe } from './tiempo';
import type { Ajustes, FechaISO, InstanteISO } from './tipos';

/**
 * Clasificación automática de horas normales y horas extra (§ parte semanal).
 *
 * Bitácora no puede preguntar cada vez «¿esto era horario normal?» — el
 * horario del usuario ya lo dice: cambia según el mes (jornada intensiva de
 * verano) y según el día de la semana (más horas de lunes a jueves, menos el
 * viernes). Lo que importa cada día es cuántas horas hay que hacer en total,
 * no a qué hora se empieza, se termina o se para a comer: da igual el
 * comienzo y el final, solo se suman las horas trabajadas y se comparan con
 * las que tocan ese día. Si suma menos, no hay hora extra —tampoco horas
 * «negativas»—; si suma más, todo lo que pase de ahí es hora extra.
 *
 * Una salida de guardia es aparte: siempre es hora extra, cuente lo que
 * cuente el horario ese día, porque por definición ocurre fuera del turno
 * asignado. Su cómputo vive en `parteSemanal.ts`, no aquí.
 */

/** Un tramo de horario, en `HH:MM` de 24 horas. Solo importa su duración. */
export interface Tramo {
  inicio: string;
  fin: string;
}

export interface HorarioLaboral {
  /** Primer y último mes (1-12) de la jornada intensiva de verano. */
  mesInicioVerano: number;
  mesFinVerano: number;
  /** Único tramo de la jornada intensiva: mismo horario todos los días laborables. */
  verano: Tramo;
  /** Turno partido de lunes a jueves el resto del año. Dos tramos, mañana y tarde. */
  lunesJueves: Tramo[];
  /** Jornada continua los viernes, fuera de la jornada intensiva. */
  viernes: Tramo;
}

export function horarioDesdeAjustes(ajustes: Ajustes): HorarioLaboral {
  return {
    mesInicioVerano: ajustes.horario_verano_mes_inicio,
    mesFinVerano: ajustes.horario_verano_mes_fin,
    verano: { inicio: ajustes.horario_verano_inicio, fin: ajustes.horario_verano_fin },
    lunesJueves: [
      { inicio: ajustes.horario_lj_manana_inicio, fin: ajustes.horario_lj_manana_fin },
      { inicio: ajustes.horario_lj_tarde_inicio, fin: ajustes.horario_lj_tarde_fin },
    ],
    viernes: { inicio: ajustes.horario_viernes_inicio, fin: ajustes.horario_viernes_fin },
  };
}

/**
 * Tramos normales de un día concreto. Vacío en fin de semana: no es que no
 * haya tramos que mirar, es que ese día no hay horario que cumplir, así que
 * cualquier jornada registrada ahí es entera hora extra.
 *
 * El verano manda sobre el viernes: en julio y agosto todos los días
 * laborables usan la jornada intensiva, viernes incluido.
 */
export function tramosDelDia(fecha: FechaISO, horario: HorarioLaboral): Tramo[] {
  const diaSemana = aFechaLocal(fecha).getDay(); // 0 domingo … 6 sábado
  if (diaSemana === 0 || diaSemana === 6) return [];

  const mes = Number(fecha.split('-')[1]);
  const esVerano = mes >= horario.mesInicioVerano && mes <= horario.mesFinVerano;
  if (esVerano) return [horario.verano];

  if (diaSemana === 5) return [horario.viernes];

  return horario.lunesJueves;
}

function minutosDeHora(horaHHMM: string): number {
  const [horas, minutos] = horaHHMM.split(':').map(Number);
  return (horas ?? 0) * 60 + (minutos ?? 0);
}

/**
 * Cuántos minutos hay que trabajar ese día para no generar hora extra: la
 * suma de la duración de sus tramos, no las horas concretas de cada uno. Así,
 * quien no hace la pausa exactamente a la hora del tramo configurado —o la
 * hace más larga, más corta, o no la hace— no ve horas extra falsas solo por
 * eso: lo único que cuenta es el total del día.
 */
export function minutosRequeridosDelDia(fecha: FechaISO, horario: HorarioLaboral): number {
  return tramosDelDia(fecha, horario).reduce(
    (total, tramo) => total + (minutosDeHora(tramo.fin) - minutosDeHora(tramo.inicio)),
    0,
  );
}

/**
 * Lo que sobra de la jornada una vez llegado a las horas exigidas ese día.
 * Compara solo el total: no le importa la hora de entrada ni de salida, ni
 * dónde cae el descanso dentro de la jornada.
 */
export function minutosExtraAutomaticos(
  horaInicio: InstanteISO,
  horaFin: InstanteISO | null,
  horario: HorarioLaboral,
): number {
  const totalMinutos = duracionMinutos(horaInicio, horaFin);
  if (totalMinutos === null || totalMinutos <= 0) return 0;
  const requeridos = minutosRequeridosDelDia(fechaDe(horaInicio), horario);
  return Math.max(0, totalMinutos - requeridos);
}

/**
 * `90` → `1:30`, `60` → `1`, `45` → `0:45`. Formato de la columna H/E del
 * parte semanal. Vive aquí, no en `informes/parteSemanal.ts`, para poder
 * mostrar el mismo cálculo en la vista previa sin cargar `docx`.
 */
export function formateaHorasExtra(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}` : `${horas}:${String(resto).padStart(2, '0')}`;
}
