import { abrirBD } from './db';
import { publica } from './bus';
import { ahora, aInstanteISO } from '../domain/tiempo';
import type { Coleccion, ElementoOutbox, Jornada, Nota, Ubicacion } from '../domain/tipos';

/**
 * Cola outbox (§4).
 *
 * La app escribe siempre en IndexedDB y encola. Un proceso aparte vacía la cola
 * cuando hay red. La interfaz nunca espera.
 */

/** Espera creciente entre reintentos, nunca en bucle. */
const ESPERAS_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3_600_000];
/** A partir de aquí el elemento se marca como fallido y se avisa en pantalla. */
export const MAX_INTENTOS = ESPERAS_MS.length;

export function esperaTrasIntentos(intentos: number): number {
  return ESPERAS_MS[Math.min(intentos, ESPERAS_MS.length - 1)] ?? 0;
}

export function proximoIntento(intentos: number, desde: Date = new Date()): string {
  return aInstanteISO(new Date(desde.getTime() + esperaTrasIntentos(intentos)));
}

/**
 * Encola un upsert. Idempotente por (coleccion, entidad_id): volver a encolar
 * la misma entidad sustituye los datos pendientes en vez de acumular trabajo, y
 * reinicia la espera porque hay algo nuevo que mandar.
 */
export async function encola(
  coleccion: Coleccion,
  datos: Jornada | Ubicacion | Nota,
): Promise<void> {
  const bd = await abrirBD();
  const tx = bd.transaction('outbox', 'readwrite');
  const indice = tx.store.index('por-entidad');
  const existente = await indice.get([coleccion, datos.id]);

  const elemento: ElementoOutbox = {
    id: existente?.id ?? crypto.randomUUID(),
    coleccion,
    operacion: 'upsert',
    entidad_id: datos.id,
    datos,
    intentos: 0,
    ultimo_error: null,
    siguiente_intento: ahora(),
    estado: 'pendiente',
    encolado_en: existente?.encolado_en ?? ahora(),
  };

  await tx.store.put(elemento);
  await tx.done;
  publica('outbox');
}

/** Elementos que toca intentar ahora (pendientes con la espera cumplida). */
export async function pendientesListos(referencia: Date = new Date()): Promise<ElementoOutbox[]> {
  const bd = await abrirBD();
  const todos = await bd.getAllFromIndex('outbox', 'por-estado', 'pendiente');
  const corte = referencia.getTime();
  return todos
    .filter((e) => new Date(e.siguiente_intento).getTime() <= corte)
    .sort((a, b) => a.encolado_en.localeCompare(b.encolado_en));
}

export async function todosLosElementos(): Promise<ElementoOutbox[]> {
  const bd = await abrirBD();
  return bd.getAll('outbox');
}

export async function cuentaPendientes(): Promise<{ pendientes: number; fallidos: number }> {
  const bd = await abrirBD();
  const todos = await bd.getAll('outbox');
  return {
    pendientes: todos.filter((e) => e.estado === 'pendiente').length,
    fallidos: todos.filter((e) => e.estado === 'fallido').length,
  };
}

export async function marcaEnviado(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const bd = await abrirBD();
  const tx = bd.transaction('outbox', 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
  publica('outbox');
}

/**
 * Marca un intento fallido. Si el error es permanente o se agotan los
 * reintentos, el elemento queda en `fallido` y se avisa en pantalla: nunca se
 * falla en silencio.
 */
export async function marcaFallo(
  ids: string[],
  error: string,
  permanente = false,
): Promise<void> {
  if (ids.length === 0) return;
  const bd = await abrirBD();
  const tx = bd.transaction('outbox', 'readwrite');
  for (const id of ids) {
    const elemento = await tx.store.get(id);
    if (!elemento) continue;
    const intentos = elemento.intentos + 1;
    const agotado = permanente || intentos >= MAX_INTENTOS;
    await tx.store.put({
      ...elemento,
      intentos,
      ultimo_error: error,
      estado: agotado ? 'fallido' : 'pendiente',
      siguiente_intento: agotado ? elemento.siguiente_intento : proximoIntento(intentos),
    });
  }
  await tx.done;
  publica('outbox');
}

/** Devuelve a la cola los elementos marcados como fallidos (acción manual). */
export async function reintentaFallidos(): Promise<number> {
  const bd = await abrirBD();
  const tx = bd.transaction('outbox', 'readwrite');
  const fallidos = await tx.store.index('por-estado').getAll('fallido');
  for (const elemento of fallidos) {
    await tx.store.put({
      ...elemento,
      estado: 'pendiente',
      intentos: 0,
      siguiente_intento: ahora(),
    });
  }
  await tx.done;
  publica('outbox');
  return fallidos.length;
}
