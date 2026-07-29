import { leeAjustes } from '../db/repos';
import {
  cuentaPendientes,
  marcaEnviado,
  marcaFallo,
  pendientesListos,
} from '../db/outbox';
import { publica, suscribe } from '../db/bus';
import { ErrorApi, escribeValores, leeIndiceDeFilas, type RangoValores } from './drive';
import { ErrorAutenticacion, configuraCliente, obtenToken, olvidaToken } from './google';
import { construyeFila, rangoFila } from './hojas';
import type { Coleccion, ElementoOutbox } from '../domain/tipos';

/**
 * Vaciado de la cola (§4).
 *
 * Corre aparte de la interfaz. La interfaz nunca espera a la red: escribe en
 * IndexedDB, encola y sigue. Aquí solo se decide *cuándo* se manda y qué hacer
 * cuando falla — y falle lo que falle, se ve en pantalla. Nunca en silencio.
 */

export type EstadoSync =
  | 'sin_configurar'
  | 'requiere_sesion'
  | 'al_dia'
  | 'pendiente'
  | 'sincronizando'
  | 'fallo';

export interface InfoSync {
  estado: EstadoSync;
  pendientes: number;
  fallidos: number;
  mensaje: string | null;
  ultimo_exito: string | null;
}

let info: InfoSync = {
  estado: 'al_dia',
  pendientes: 0,
  fallidos: 0,
  mensaje: null,
  ultimo_exito: null,
};

const oyentes = new Set<(info: InfoSync) => void>();

export function estadoSync(): InfoSync {
  return info;
}

export function observaSync(oyente: (info: InfoSync) => void): () => void {
  oyentes.add(oyente);
  oyente(info);
  return () => oyentes.delete(oyente);
}

function actualiza(cambios: Partial<InfoSync>): void {
  info = { ...info, ...cambios };
  for (const oyente of [...oyentes]) oyente(info);
}

async function refrescaContadores(): Promise<{ pendientes: number; fallidos: number }> {
  const cuenta = await cuentaPendientes();
  actualiza(cuenta);
  return cuenta;
}

/** Agrupa los elementos por hoja conservando el orden de encolado. */
function agrupa(elementos: ElementoOutbox[]): Map<Coleccion, ElementoOutbox[]> {
  const grupos = new Map<Coleccion, ElementoOutbox[]>();
  for (const elemento of elementos) {
    const grupo = grupos.get(elemento.coleccion) ?? [];
    grupo.push(elemento);
    grupos.set(elemento.coleccion, grupo);
  }
  return grupos;
}

let vaciadoEnCurso: Promise<void> | null = null;

/**
 * Intenta enviar todo lo pendiente. Se puede llamar tantas veces como se
 * quiera: si ya hay un vaciado en curso, devuelve el mismo.
 */
export function vaciaCola(): Promise<void> {
  if (!vaciadoEnCurso) {
    vaciadoEnCurso = ejecutaVaciado().finally(() => {
      vaciadoEnCurso = null;
    });
  }
  return vaciadoEnCurso;
}

async function ejecutaVaciado(): Promise<void> {
  const ajustes = await leeAjustes();
  const cuenta = await refrescaContadores();

  if (!ajustes.google_client_id || !ajustes.spreadsheet_id) {
    actualiza({
      estado: 'sin_configurar',
      mensaje: 'Falta conectar Google. Los datos están a salvo en el móvil.',
    });
    return;
  }
  configuraCliente(ajustes.google_client_id);

  if (cuenta.fallidos > 0 && cuenta.pendientes === 0) {
    actualiza({ estado: 'fallo' });
    return;
  }
  if (cuenta.pendientes === 0) {
    actualiza({ estado: 'al_dia', mensaje: null });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    actualiza({ estado: 'pendiente', mensaje: 'Sin conexión. Se enviará al recuperarla.' });
    return;
  }

  const listos = await pendientesListos();
  if (listos.length === 0) {
    actualiza({ estado: 'pendiente', mensaje: 'Reintento programado.' });
    return;
  }

  actualiza({ estado: 'sincronizando', mensaje: null });

  let token: string;
  try {
    token = await obtenToken(false);
  } catch (error) {
    // Renovar en silencio no siempre es posible: hace falta un gesto del usuario.
    const mensaje = error instanceof Error ? error.message : 'No se ha podido acceder a Google';
    actualiza({ estado: 'requiere_sesion', mensaje });
    return;
  }

  try {
    await enviaLote(token, listos, ajustes.spreadsheet_id);
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 401) {
      // 401 → renovar token y reintentar, una sola vez.
      olvidaToken();
      try {
        const nuevo = await obtenToken(false);
        await enviaLote(nuevo, listos, ajustes.spreadsheet_id);
      } catch (segundo) {
        await registraFallo(listos, segundo);
        return;
      }
    } else {
      await registraFallo(listos, error);
      return;
    }
  }

  const despues = await refrescaContadores();
  actualiza({
    estado: despues.fallidos > 0 ? 'fallo' : despues.pendientes > 0 ? 'pendiente' : 'al_dia',
    mensaje: despues.fallidos > 0 ? 'Hay registros que no se han podido enviar.' : null,
    ultimo_exito: new Date().toISOString(),
  });
}

/**
 * Un lote = una lectura de ids + una escritura. No una llamada por registro:
 * los límites de la API se gastan en peticiones, no en filas.
 */
async function enviaLote(
  token: string,
  elementos: ElementoOutbox[],
  spreadsheetId: string,
): Promise<void> {
  const indice = await leeIndiceDeFilas(token, spreadsheetId);
  const datos: RangoValores[] = [];

  for (const [coleccion, grupo] of agrupa(elementos)) {
    const filasExistentes = indice[coleccion];
    // La primera fila libre va después de la última ocupada; las filas nuevas de
    // este mismo lote se reservan según se asignan, para que no colisionen.
    let siguienteLibre = 2;
    for (const fila of filasExistentes.values()) {
      if (fila >= siguienteLibre) siguienteLibre = fila + 1;
    }

    for (const elemento of grupo) {
      const existente = filasExistentes.get(elemento.entidad_id);
      const fila = existente ?? siguienteLibre++;
      // Registrada para que dos elementos de la misma entidad en el mismo lote
      // escriban en la misma fila.
      filasExistentes.set(elemento.entidad_id, fila);
      datos.push({
        range: rangoFila(coleccion, fila),
        values: [construyeFila(coleccion, elemento.datos, fila)],
      });
    }
  }

  await escribeValores(token, spreadsheetId, datos);
  await marcaEnviado(elementos.map((e) => e.id));
}

async function registraFallo(elementos: ElementoOutbox[], error: unknown): Promise<void> {
  const permanente = error instanceof ErrorApi && error.permanente;
  const mensaje = error instanceof Error ? error.message : String(error);
  await marcaFallo(
    elementos.map((e) => e.id),
    mensaje,
    permanente,
  );
  const cuenta = await refrescaContadores();
  actualiza({
    estado: cuenta.fallidos > 0 ? 'fallo' : 'pendiente',
    mensaje: permanente ? `Error permanente: ${mensaje}` : `Reintento pendiente: ${mensaje}`,
  });
}

/** Pide acceso a Google con la ventana visible. Solo desde un gesto del usuario. */
export async function conectaGoogle(): Promise<void> {
  const ajustes = await leeAjustes();
  if (!ajustes.google_client_id) {
    throw new ErrorAutenticacion('Falta el Client ID de Google. Configúralo en Ajustes.');
  }
  configuraCliente(ajustes.google_client_id);
  await obtenToken(true);
  publica('ajustes');
  await vaciaCola();
}

// ---------------------------------------------------------------------------
// Disparadores
// ---------------------------------------------------------------------------

const INTERVALO_MS = 5 * 60_000;
let temporizador: ReturnType<typeof setTimeout> | null = null;
let arrancado = false;

/** Arranca el proceso de vaciado. Idempotente. */
export function arrancaSincronizacion(): void {
  if (arrancado) return;
  arrancado = true;

  const disparar = () => {
    void vaciaCola();
  };

  suscribe((tema) => {
    if (tema === 'outbox' || tema === 'ajustes') {
      if (temporizador) clearTimeout(temporizador);
      // Pequeño respiro: cerrar una jornada encola varias entidades seguidas y
      // se prefiere mandarlas juntas.
      temporizador = setTimeout(disparar, 1_500);
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', disparar);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') disparar();
    });
    setInterval(disparar, INTERVALO_MS);
  }

  disparar();
}
