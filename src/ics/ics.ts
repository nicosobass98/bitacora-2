import { milisegundos } from '../domain/tiempo';
import type { Nota } from '../domain/tipos';

/**
 * Generación de ficheros `.ics` (§6).
 *
 * Las notificaciones programadas no existen en el estándar de la API de
 * Notifications —no es que sean poco fiables en una PWA: no existen—, así que
 * el aviso se delega al sistema operativo. La app genera el evento, el
 * calendario avisa, y la app sigue siendo la fuente de verdad.
 */

const PRODID = '-//Bitacora//Bitacora v2//ES';
/** Duración del evento en el calendario. Es un aviso, no una reunión. */
const MINUTOS_EVENTO = 15;

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/** Formato UTC de iCalendar: `20260729T080300Z`. */
export function aFormatoICS(instante: string): string {
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) throw new Error(`Instante no válido: ${instante}`);
  return (
    `${fecha.getUTCFullYear()}${dosDigitos(fecha.getUTCMonth() + 1)}${dosDigitos(fecha.getUTCDate())}` +
    `T${dosDigitos(fecha.getUTCHours())}${dosDigitos(fecha.getUTCMinutes())}${dosDigitos(fecha.getUTCSeconds())}Z`
  );
}

/** Escapado de TEXT según RFC 5545: `\`, `;`, `,` y saltos de línea. */
export function escapaTexto(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Plegado de líneas a 75 octetos (RFC 5545). Se mide en bytes UTF-8, no en
 * caracteres: partir una línea por la mitad de una `ñ` rompe el fichero.
 */
export function pliegaLinea(linea: string): string {
  const codificador = new TextEncoder();
  if (codificador.encode(linea).length <= 75) return linea;

  const partes: string[] = [];
  let actual = '';
  let octetos = 0;
  let limite = 75;

  for (const caracter of linea) {
    const tamano = codificador.encode(caracter).length;
    if (octetos + tamano > limite) {
      partes.push(actual);
      actual = caracter;
      octetos = tamano + 1; // el espacio inicial de la continuación cuenta
      limite = 75;
    } else {
      actual += caracter;
      octetos += tamano;
    }
  }
  partes.push(actual);
  return partes.join('\r\n ');
}

export interface OpcionesEvento {
  /** Minutos de antelación del aviso. 0 = a la hora exacta. */
  minutosAntes?: number;
  /** Instante de generación, inyectable para las pruebas. */
  ahora?: Date;
}

/**
 * Construye el `.ics` de un recordatorio. El UID es el id de la nota: si el
 * usuario vuelve a añadirlo, el calendario actualiza el evento en vez de
 * duplicarlo.
 */
export function construyeICS(nota: Nota, opciones: OpcionesEvento = {}): string {
  if (!nota.fecha_aviso) throw new Error('La nota no tiene fecha de aviso');

  const minutosAntes = opciones.minutosAntes ?? 0;
  const inicio = nota.fecha_aviso;
  const fin = new Date(milisegundos(inicio) + MINUTOS_EVENTO * 60_000).toISOString();
  const resumen = nota.texto.split('\n')[0]?.slice(0, 120) || 'Recordatorio';
  const descripcion = [nota.texto, nota.etiqueta ? `Etiqueta: ${nota.etiqueta}` : '']
    .filter(Boolean)
    .join('\n');
  const disparador = minutosAntes > 0 ? `-PT${minutosAntes}M` : 'PT0S';

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${nota.id}@bitacora.local`,
    `DTSTAMP:${aFormatoICS((opciones.ahora ?? new Date()).toISOString())}`,
    `DTSTART:${aFormatoICS(inicio)}`,
    `DTEND:${aFormatoICS(fin)}`,
    `SUMMARY:${escapaTexto(resumen)}`,
    `DESCRIPTION:${escapaTexto(descripcion)}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapaTexto(resumen)}`,
    `TRIGGER;RELATED=START:${disparador}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lineas.map(pliegaLinea).join('\r\n') + '\r\n';
}

export function nombreFichero(nota: Nota): string {
  const base = (nota.texto.split('\n')[0] ?? 'recordatorio')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'recordatorio'}.ics`;
}

/**
 * Entrega el fichero al sistema. Se intenta compartir primero porque en Android
 * es lo que ofrece directamente el calendario; si no hay soporte, se descarga.
 *
 * Lo que **no** hace esta función es dar por bueno el resultado: quien la llama
 * marca `enviado_a_calendario` solo cuando el usuario confirma que el evento
 * está creado. La nota nunca se va de la app.
 */
export async function entregaICS(nota: Nota, opciones: OpcionesEvento = {}): Promise<void> {
  const contenido = construyeICS(nota, opciones);
  const fichero = nombreFichero(nota);
  const blob = new Blob([contenido], { type: 'text/calendar;charset=utf-8' });

  if (typeof navigator !== 'undefined' && 'canShare' in navigator) {
    const adjunto = new File([blob], fichero, { type: 'text/calendar' });
    if (navigator.canShare?.({ files: [adjunto] })) {
      try {
        await navigator.share({ files: [adjunto], title: 'Recordatorio' });
        return;
      } catch (error) {
        // Cancelar el diálogo no es un error que merezca ruido: se descarga.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = fichero;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
