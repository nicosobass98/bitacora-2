/**
 * Bus de cambios mínimo.
 *
 * Toda escritura publica el nombre de la colección tocada; las vistas se
 * resuscriben y vuelven a consultar. No hay estado duplicado en memoria: la
 * pantalla siempre lee de IndexedDB, que es la fuente de verdad.
 */

export type TemaCambio = 'jornadas' | 'ubicaciones' | 'notas' | 'outbox' | 'ajustes';

type Oyente = (tema: TemaCambio) => void;

const oyentes = new Set<Oyente>();

export function suscribe(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function publica(...temas: TemaCambio[]): void {
  for (const tema of temas) {
    for (const oyente of [...oyentes]) oyente(tema);
  }
}
