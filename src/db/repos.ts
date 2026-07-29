import { abrirBD } from './db';
import { publica } from './bus';
import { encola } from './outbox';
import { ahora, fechaDe, hoy } from '../domain/tiempo';
import {
  AJUSTES_POR_DEFECTO,
  type Ajustes,
  type EstadoJornada,
  type FechaISO,
  type Jornada,
  type Motivo,
  type Nota,
  type Sistema,
  type Ubicacion,
  type UUID,
} from '../domain/tipos';

// ---------------------------------------------------------------------------
// Jornadas
// ---------------------------------------------------------------------------

/**
 * Abre una jornada. Dos toques (§5.2), y ninguno obligatorio: si falta la
 * ubicación se abre igual como «sin asignar». Nunca se bloquea al usuario en la
 * puerta de un sitio.
 *
 * No se encola nada aquí: se sincroniza solo al cerrar (§4). Una jornada
 * abierta vive solo en el móvil.
 */
export async function abreJornada(datos: {
  ubicacion_id?: UUID | null;
  motivo?: Motivo | null;
  sistema?: Sistema | null;
}): Promise<Jornada> {
  const instante = ahora();
  const jornada: Jornada = {
    id: crypto.randomUUID(),
    fecha: fechaDe(instante),
    hora_inicio: instante,
    hora_fin: null,
    ubicacion_id: datos.ubicacion_id ?? null,
    motivo: datos.motivo ?? null,
    sistema: datos.sistema ?? null,
    notas: '',
    estado: 'abierta',
    actualizado_en: instante,
  };

  const bd = await abrirBD();
  await bd.put('jornadas', jornada);
  if (jornada.ubicacion_id) await marcaUbicacionUsada(jornada.ubicacion_id);
  publica('jornadas');
  return jornada;
}

/**
 * Una jornada está completa cuando se puede encontrar en las dos búsquedas de
 * §5.6 y significa algo en un parte. Sin ubicación o sin motivo es un agujero
 * en el histórico, no una jornada.
 */
export function estaCompleta(jornada: Jornada): boolean {
  return Boolean(jornada.ubicacion_id && jornada.motivo && jornada.hora_fin);
}

/**
 * Cierra la jornada y la encola. Una jornada cerrada deprisa —sin ubicación o
 * sin motivo— queda en `incompleta` (§5.3); se sincroniza igualmente, porque el
 * dato real ya existe y perderlo sería peor.
 */
export async function cierraJornada(
  id: UUID,
  cambios: { hora_fin?: string; notas?: string } = {},
): Promise<Jornada> {
  const bd = await abrirBD();
  const actual = await bd.get('jornadas', id);
  if (!actual) throw new Error(`No existe la jornada ${id}`);

  const hora_fin = cambios.hora_fin ?? ahora();
  const cerrada: Jornada = {
    ...actual,
    hora_fin,
    notas: cambios.notas ?? actual.notas,
    actualizado_en: ahora(),
    estado: 'cerrada',
  };
  cerrada.estado = estaCompleta(cerrada) ? 'cerrada' : 'incompleta';

  await bd.put('jornadas', cerrada);
  publica('jornadas');
  await sincronizaJornada(cerrada);
  return cerrada;
}

/** Guarda cambios de una jornada ya existente y reencola si ya estaba cerrada. */
export async function guardaJornada(jornada: Jornada): Promise<Jornada> {
  const bd = await abrirBD();
  const actualizada: Jornada = {
    ...jornada,
    fecha: fechaDe(jornada.hora_inicio),
    actualizado_en: ahora(),
  };
  if (actualizada.estado !== 'abierta') {
    actualizada.estado = estaCompleta(actualizada) ? 'cerrada' : 'incompleta';
  }

  await bd.put('jornadas', actualizada);
  if (actualizada.ubicacion_id) await marcaUbicacionUsada(actualizada.ubicacion_id);
  publica('jornadas');

  // Una jornada abierta no se sincroniza todavía (§4).
  if (actualizada.estado !== 'abierta') await sincronizaJornada(actualizada);
  return actualizada;
}

/**
 * Encola la jornada y, con ella, su ubicación: la hoja tiene que poder leerse
 * sin que un `ubicacion_id` apunte a una fila que no existe.
 */
async function sincronizaJornada(jornada: Jornada): Promise<void> {
  await encola('jornadas', jornada);
  if (jornada.ubicacion_id) {
    const ubicacion = await obtenUbicacion(jornada.ubicacion_id);
    if (ubicacion) await encola('ubicaciones', ubicacion);
  }
}

export async function obtenJornada(id: UUID): Promise<Jornada | undefined> {
  const bd = await abrirBD();
  return bd.get('jornadas', id);
}

export async function borraJornada(id: UUID): Promise<void> {
  const bd = await abrirBD();
  await bd.delete('jornadas', id);
  publica('jornadas');
}

/** La jornada abierta, si la hay. Por diseño solo puede haber una a la vez. */
export async function jornadaAbierta(): Promise<Jornada | undefined> {
  const bd = await abrirBD();
  const abiertas = await bd.getAllFromIndex('jornadas', 'por-estado', 'abierta');
  return abiertas.sort((a, b) => b.hora_inicio.localeCompare(a.hora_inicio))[0];
}

export async function jornadasPorFecha(fecha: FechaISO): Promise<Jornada[]> {
  const bd = await abrirBD();
  const jornadas = await bd.getAllFromIndex('jornadas', 'por-fecha', fecha);
  return jornadas.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
}

export async function jornadasPorUbicacion(ubicacionId: UUID): Promise<Jornada[]> {
  const bd = await abrirBD();
  const jornadas = await bd.getAllFromIndex('jornadas', 'por-ubicacion', ubicacionId);
  return jornadas.sort((a, b) => b.hora_inicio.localeCompare(a.hora_inicio));
}

export async function todasLasJornadas(): Promise<Jornada[]> {
  const bd = await abrirBD();
  const jornadas = await bd.getAll('jornadas');
  return jornadas.sort((a, b) => b.hora_inicio.localeCompare(a.hora_inicio));
}

/**
 * Jornadas por completar (§5.4). No es un contador decorativo: estas jornadas
 * no aparecen en ninguna de las dos búsquedas.
 */
export async function jornadasPorCompletar(): Promise<Jornada[]> {
  const bd = await abrirBD();
  const jornadas = await bd.getAll('jornadas');
  return jornadas
    .filter((j) => j.estado !== 'abierta' && !estaCompleta(j))
    .sort((a, b) => b.hora_inicio.localeCompare(a.hora_inicio));
}

export async function jornadasConEstado(estado: EstadoJornada): Promise<Jornada[]> {
  const bd = await abrirBD();
  return bd.getAllFromIndex('jornadas', 'por-estado', estado);
}

// ---------------------------------------------------------------------------
// Ubicaciones
// ---------------------------------------------------------------------------

export async function creaUbicacion(datos: {
  nombre: string;
  direccion?: string;
  cliente?: string;
  notas_acceso?: string;
}): Promise<Ubicacion> {
  const ubicacion: Ubicacion = {
    id: crypto.randomUUID(),
    nombre: datos.nombre.trim(),
    direccion: datos.direccion?.trim() ?? '',
    cliente: datos.cliente?.trim() ?? '',
    notas_acceso: datos.notas_acceso?.trim() ?? '',
    actualizado_en: ahora(),
    usado_en: ahora(),
  };
  const bd = await abrirBD();
  await bd.put('ubicaciones', ubicacion);
  publica('ubicaciones');
  await encola('ubicaciones', ubicacion);
  return ubicacion;
}

export async function guardaUbicacion(ubicacion: Ubicacion): Promise<Ubicacion> {
  const actualizada = { ...ubicacion, actualizado_en: ahora() };
  const bd = await abrirBD();
  await bd.put('ubicaciones', actualizada);
  publica('ubicaciones');
  await encola('ubicaciones', actualizada);
  return actualizada;
}

/** El «uso reciente» es solo local: ordena el autocompletado, no viaja a la hoja. */
async function marcaUbicacionUsada(id: UUID): Promise<void> {
  const bd = await abrirBD();
  const ubicacion = await bd.get('ubicaciones', id);
  if (!ubicacion) return;
  await bd.put('ubicaciones', { ...ubicacion, usado_en: ahora() });
  publica('ubicaciones');
}

export async function obtenUbicacion(id: UUID): Promise<Ubicacion | undefined> {
  const bd = await abrirBD();
  return bd.get('ubicaciones', id);
}

export async function todasLasUbicaciones(): Promise<Ubicacion[]> {
  const bd = await abrirBD();
  return bd.getAll('ubicaciones');
}

/** Ubicaciones ordenadas por uso reciente, para el autocompletado de §5.2. */
export async function ubicacionesPorUsoReciente(): Promise<Ubicacion[]> {
  const ubicaciones = await todasLasUbicaciones();
  return ubicaciones.sort((a, b) => {
    const usoA = a.usado_en ?? '';
    const usoB = b.usado_en ?? '';
    if (usoA !== usoB) return usoB.localeCompare(usoA);
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

/**
 * Crea una nota. Si hay jornada abierta, hereda `ubicacion_id` y `jornada_id`
 * automáticamente (§5.5) — salvo que se indique otra ubicación a mano, porque
 * el viernes se puede escribir una nota sobre el sitio del miércoles.
 */
export async function creaNota(datos: {
  texto: string;
  fecha_aviso?: string | null;
  etiqueta?: string;
  jornada_id?: UUID | null;
  ubicacion_id?: UUID | null;
  heredarDeJornadaAbierta?: boolean;
}): Promise<Nota> {
  let jornada_id = datos.jornada_id ?? null;
  let ubicacion_id = datos.ubicacion_id ?? null;

  if (datos.heredarDeJornadaAbierta !== false && !jornada_id) {
    const abierta = await jornadaAbierta();
    if (abierta) {
      jornada_id = abierta.id;
      if (!ubicacion_id) ubicacion_id = abierta.ubicacion_id;
    }
  }

  const nota: Nota = {
    id: crypto.randomUUID(),
    creado_en: ahora(),
    texto: datos.texto.trim(),
    tipo: datos.fecha_aviso ? 'recordatorio' : 'nota',
    fecha_aviso: datos.fecha_aviso ?? null,
    estado: 'pendiente',
    etiqueta: datos.etiqueta?.trim() ?? '',
    jornada_id,
    ubicacion_id,
    enviado_a_calendario: false,
    actualizado_en: ahora(),
  };

  const bd = await abrirBD();
  await bd.put('notas', nota);
  publica('notas');
  await encola('notas', nota);
  return nota;
}

export async function guardaNota(nota: Nota): Promise<Nota> {
  const actualizada: Nota = {
    ...nota,
    tipo: nota.fecha_aviso ? 'recordatorio' : 'nota',
    actualizado_en: ahora(),
  };
  const bd = await abrirBD();
  await bd.put('notas', actualizada);
  publica('notas');
  await encola('notas', actualizada);
  return actualizada;
}

export async function obtenNota(id: UUID): Promise<Nota | undefined> {
  const bd = await abrirBD();
  return bd.get('notas', id);
}

export async function borraNota(id: UUID): Promise<void> {
  const bd = await abrirBD();
  await bd.delete('notas', id);
  publica('notas');
}

export async function todasLasNotas(): Promise<Nota[]> {
  const bd = await abrirBD();
  const notas = await bd.getAll('notas');
  return notas.sort((a, b) => b.creado_en.localeCompare(a.creado_en));
}

export async function notasPorUbicacion(ubicacionId: UUID): Promise<Nota[]> {
  const bd = await abrirBD();
  return bd.getAllFromIndex('notas', 'por-ubicacion', ubicacionId);
}

export async function notasPorJornada(jornadaId: UUID): Promise<Nota[]> {
  const bd = await abrirBD();
  return bd.getAllFromIndex('notas', 'por-jornada', jornadaId);
}

/** Recordatorios pendientes cuyo aviso cae hoy o ya ha pasado (§5.1). */
export async function pendientesDeHoy(fecha: FechaISO = hoy()): Promise<Nota[]> {
  const bd = await abrirBD();
  const pendientes = await bd.getAllFromIndex('notas', 'por-estado', 'pendiente');
  const limite = `${fecha}T23:59:59`;
  return pendientes
    .filter((n) => n.fecha_aviso !== null && n.fecha_aviso <= limite)
    .sort((a, b) => (a.fecha_aviso ?? '').localeCompare(b.fecha_aviso ?? ''));
}

/**
 * Recordatorios que aún no han llegado al calendario (§6). Se muestran
 * destacados: confiar en un aviso que no existe es peor que no tener aviso.
 */
export async function recordatoriosSinCalendario(): Promise<Nota[]> {
  const bd = await abrirBD();
  const pendientes = await bd.getAllFromIndex('notas', 'por-estado', 'pendiente');
  return pendientes.filter((n) => n.fecha_aviso !== null && !n.enviado_a_calendario);
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

export async function leeAjustes(): Promise<Ajustes> {
  const bd = await abrirBD();
  const filas = await bd.getAll('ajustes');
  const ajustes = { ...AJUSTES_POR_DEFECTO };
  for (const fila of filas) {
    if (fila.clave in ajustes) {
      (ajustes as Record<string, unknown>)[fila.clave] = fila.valor;
    }
  }
  // El client ID puede venir de la compilación; el valor guardado manda.
  const porEntorno = import.meta.env?.VITE_GOOGLE_CLIENT_ID;
  if (!ajustes.google_client_id && typeof porEntorno === 'string') {
    ajustes.google_client_id = porEntorno;
  }
  return ajustes;
}

export async function guardaAjustes(cambios: Partial<Ajustes>): Promise<void> {
  const bd = await abrirBD();
  const tx = bd.transaction('ajustes', 'readwrite');
  for (const [clave, valor] of Object.entries(cambios)) {
    await tx.store.put({ clave, valor });
  }
  await tx.done;
  publica('ajustes');
}
