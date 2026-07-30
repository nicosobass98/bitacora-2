import type { FechaISO, InstanteISO } from './tipos';

/**
 * Utilidades de fecha y hora.
 *
 * Regla transversal (§7): fechas y horas siempre con zona horaria completa. Aquí
 * no se usa `Date.toISOString()` para *almacenar*, porque normaliza a UTC y
 * pierde el desfase local — que es justo el dato que hace falta para leer un
 * parte seis meses después sin dudar de si eran las 02:30 de antes o de después
 * del cambio de hora.
 */

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/** Desfase local en formato `+02:00` / `-05:00` / `Z`. */
export function desfaseHorario(fecha: Date): string {
  const minutos = -fecha.getTimezoneOffset();
  if (minutos === 0) return 'Z';
  const signo = minutos < 0 ? '-' : '+';
  const abs = Math.abs(minutos);
  return `${signo}${dosDigitos(Math.floor(abs / 60))}:${dosDigitos(abs % 60)}`;
}

/** Serializa un `Date` como ISO 8601 en hora local, con desfase explícito. */
export function aInstanteISO(fecha: Date = new Date()): InstanteISO {
  return (
    `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}` +
    `T${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}:${dosDigitos(fecha.getSeconds())}` +
    desfaseHorario(fecha)
  );
}

/** Fecha local `YYYY-MM-DD`. */
export function aFechaISO(fecha: Date = new Date()): FechaISO {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

export function ahora(): InstanteISO {
  return aInstanteISO(new Date());
}

export function hoy(): FechaISO {
  return aFechaISO(new Date());
}

/** La fecha local (`YYYY-MM-DD`) a la que pertenece un instante. */
export function fechaDe(instante: InstanteISO): FechaISO {
  return instante.slice(0, 10);
}

/** `HH:MM` de un instante, tal y como se registró (sin reinterpretar la zona). */
export function horaDe(instante: InstanteISO | null): string {
  if (!instante) return '--:--';
  return instante.slice(11, 16);
}

/** Valor para un `<input type="datetime-local">`. */
export function aInputDateTime(instante: InstanteISO | null): string {
  if (!instante) return '';
  return instante.slice(0, 16);
}

/**
 * Convierte el valor de un `<input type="datetime-local">` (sin zona) a
 * instante con el desfase que corresponde *a esa fecha* en la zona del
 * dispositivo — no el de hoy, para que editar una jornada de enero en julio no
 * le pegue el horario de verano.
 */
export function desdeInputDateTime(valor: string): InstanteISO | null {
  if (!valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  const conSegundos = valor.length === 16 ? `${valor}:00` : valor;
  return conSegundos + desfaseHorario(fecha);
}

/** Milisegundos absolutos de un instante ISO (respeta el desfase almacenado). */
export function milisegundos(instante: InstanteISO): number {
  return new Date(instante).getTime();
}

/**
 * Duración en minutos entre dos instantes, o `null` si falta alguno.
 *
 * Un `<input type="datetime-local">` no tiene segundos: al cerrar una jornada
 * en el mismo minuto en que se abrió, el fin queda unos segundos por detrás del
 * inicio. Eso no es un fin anterior al inicio, es una jornada de cero minutos —
 * y confundirlo bloqueaba el botón de cerrar justo en el caso que la
 * especificación llama «cerrar deprisa». Por encima del minuto, un negativo sí
 * es un dato mal metido y se devuelve como tal.
 */
export function duracionMinutos(
  inicio: InstanteISO | null,
  fin: InstanteISO | null,
): number | null {
  if (!inicio || !fin) return null;
  const diff = milisegundos(fin) - milisegundos(inicio);
  if (!Number.isFinite(diff)) return null;
  if (diff < 0 && diff > -60_000) return 0;
  return Math.round(diff / 60000);
}

/** `4 h 20 min`, `35 min`, o `—`. */
export function formateaDuracion(minutos: number | null): string {
  if (minutos === null) return '—';
  if (minutos < 0) return '—';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** `12 marzo` — y añade el año si no es el actual. */
export function formateaFechaCorta(fecha: FechaISO, hoyISO: FechaISO = hoy()): string {
  const [anio, mes, dia] = fecha.split('-');
  if (!anio || !mes || !dia) return fecha;
  const nombreMes = MESES[Number(mes) - 1] ?? mes;
  const base = `${Number(dia)} ${nombreMes}`;
  return anio === hoyISO.slice(0, 4) ? base : `${base} ${anio}`;
}

/** Horas transcurridas desde un instante hasta ahora. */
export function horasDesde(instante: InstanteISO, referencia: Date = new Date()): number {
  return (referencia.getTime() - milisegundos(instante)) / 3_600_000;
}

/**
 * Interpreta un `FechaISO` como medianoche local, nunca como UTC.
 *
 * `new Date('2026-07-29')` lo trataría como UTC y desplazaría el día al
 * convertirlo de vuelta a componentes locales — el mismo error que `tiempo.ts`
 * evita en todas partes con los instantes completos.
 */
export function aFechaLocal(fecha: FechaISO): Date {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1);
}

export function sumaDias(fecha: FechaISO, dias: number): FechaISO {
  const d = aFechaLocal(fecha);
  d.setDate(d.getDate() + dias);
  return aFechaISO(d);
}

/** Lunes de la semana (lunes a domingo) que contiene `fecha`. */
export function inicioSemana(fecha: FechaISO): FechaISO {
  const d = aFechaLocal(fecha);
  const diaSemana = d.getDay(); // 0 domingo … 6 sábado
  const desplazamiento = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + desplazamiento);
  return aFechaISO(d);
}

/** Domingo de la semana que contiene `fecha`. */
export function finSemana(fecha: FechaISO): FechaISO {
  return sumaDias(inicioSemana(fecha), 6);
}

/** `4 de mayo de 2026`, para encabezados formales como el parte semanal. */
export function formateaFechaLarga(fecha: FechaISO): string {
  const [anio, mes, dia] = fecha.split('-');
  if (!anio || !mes || !dia) return fecha;
  const nombreMes = MESES[Number(mes) - 1] ?? mes;
  return `${Number(dia)} de ${nombreMes} de ${anio}`;
}
