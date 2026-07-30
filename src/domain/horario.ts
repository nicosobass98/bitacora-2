import { aFechaLocal, aInstanteISO, duracionMinutos, fechaDe, milisegundos } from './tiempo';
import type { Ajustes, FechaISO, InstanteISO } from './tipos';

/**
 * Clasificación automática de horas normales y horas extra (§ parte semanal).
 *
 * Bitácora no puede preguntar cada vez «¿esto era horario normal?» — el
 * horario del usuario ya lo dice: cambia según el mes (jornada intensiva de
 * verano) y según el día de la semana (turno partido de lunes a jueves,
 * jornada continua los viernes). Lo que cae fuera de esos tramos, en
 * cualquier día, es hora extra sin que nadie tenga que marcarlo a mano.
 *
 * Una salida de guardia es aparte: siempre es hora extra, cuente lo que
 * cuente el horario ese día, porque por definición ocurre fuera del turno
 * asignado. Su cómputo vive en `parteSemanal.ts`, no aquí.
 */

/** Un tramo de horario, en `HH:MM` de 24 horas. */
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

function instanteDelDia(fecha: FechaISO, horaHHMM: string): InstanteISO {
  const [horas, minutos] = horaHHMM.split(':').map(Number);
  const d = aFechaLocal(fecha);
  d.setHours(horas ?? 0, minutos ?? 0, 0, 0);
  return aInstanteISO(d);
}

/**
 * Minutos de una jornada que caen dentro de su horario normal ese día — el
 * solape entre `[hora_inicio, hora_fin]` y cada tramo, sumado. Si la jornada
 * cruza el hueco entre tramos de un turno partido (p. ej. se sigue trabajando
 * en la hora de la comida), ese hueco no cuenta como normal: es justo lo que
 * hace que sea hora extra.
 */
export function minutosNormales(
  horaInicio: InstanteISO,
  horaFin: InstanteISO | null,
  horario: HorarioLaboral,
): number {
  if (!horaFin) return 0;
  const fecha = fechaDe(horaInicio);
  const inicioMs = milisegundos(horaInicio);
  const finMs = milisegundos(horaFin);

  let total = 0;
  for (const tramo of tramosDelDia(fecha, horario)) {
    const tramoInicioMs = milisegundos(instanteDelDia(fecha, tramo.inicio));
    const tramoFinMs = milisegundos(instanteDelDia(fecha, tramo.fin));
    const solapeInicio = Math.max(inicioMs, tramoInicioMs);
    const solapeFin = Math.min(finMs, tramoFinMs);
    if (solapeFin > solapeInicio) total += solapeFin - solapeInicio;
  }
  return Math.round(total / 60_000);
}

/** Lo que sobra de la jornada una vez descontado lo que cae en horario normal. */
export function minutosExtraAutomaticos(
  horaInicio: InstanteISO,
  horaFin: InstanteISO | null,
  horario: HorarioLaboral,
): number {
  const totalMinutos = duracionMinutos(horaInicio, horaFin);
  if (totalMinutos === null || totalMinutos <= 0) return 0;
  return Math.max(0, totalMinutos - minutosNormales(horaInicio, horaFin, horario));
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
