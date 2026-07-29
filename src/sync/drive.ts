import { CABECERAS, HOJAS } from './hojas';
import type { Coleccion } from '../domain/tipos';

/**
 * Cliente mínimo de las APIs de Sheets y Drive.
 *
 * Solo con scope `drive.file`, que es «no sensible». Funciona porque el
 * documento lo crea la propia app: `drive.file` da acceso a los ficheros que la
 * aplicación crea, y la API de Sheets lo acepta para esos ficheros.
 */

const API_SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export class ErrorApi extends Error {
  readonly estado: number;
  /** `true` cuando reintentar no va a arreglar nada (petición mal formada, hoja borrada…). */
  readonly permanente: boolean;

  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    // 401 lo resuelve renovar el token; 403/429 y 5xx son cuota o servidor y se
    // reintentan más tarde. El resto es culpa nuestra y no mejora solo.
    this.permanente = ![401, 403, 408, 429].includes(estado) && estado < 500;
  }
}

async function peticion<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    // Sin red no es un fallo de la petición: se reintenta más tarde.
    throw new ErrorApi(0, error instanceof Error ? error.message : 'Sin conexión');
  }

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => '');
    throw new ErrorApi(respuesta.status, `${respuesta.status} ${respuesta.statusText} ${cuerpo}`.trim());
  }
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

/**
 * Crea el documento con sus tres hojas y las cabeceras.
 *
 * `locale: en_US` no es cosmético: fija el separador de argumentos de las
 * fórmulas en `,`, que es lo que escribe `hojas.ts`. Si el documento se creara
 * con locale español, Sheets esperaría `;` y las fórmulas entrarían como texto.
 */
export async function creaDocumento(token: string, titulo: string): Promise<string> {
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

  const documento = await peticion<{ spreadsheetId: string }>(API_SHEETS, token, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: titulo, locale: 'en_US', timeZone: zonaHoraria },
      sheets: HOJAS.map((hoja, indice) => ({
        properties: { title: hoja, index: indice, gridProperties: { frozenRowCount: 1 } },
      })),
    }),
  });

  await escribeValores(
    token,
    documento.spreadsheetId,
    HOJAS.map((hoja) => ({ range: `${hoja}!A1`, values: [CABECERAS[hoja]] })),
  );

  return documento.spreadsheetId;
}

/** Comprueba que el documento sigue existiendo y es accesible. */
export async function existeDocumento(token: string, spreadsheetId: string): Promise<boolean> {
  try {
    await peticion(`${API_SHEETS}/${spreadsheetId}?fields=spreadsheetId`, token);
    return true;
  } catch (error) {
    if (error instanceof ErrorApi && (error.estado === 404 || error.estado === 403)) return false;
    throw error;
  }
}

/**
 * Lee la columna de `id` de cada hoja y devuelve, por colección, el número de
 * fila de cada id. Una sola petición para las tres hojas.
 */
export async function leeIndiceDeFilas(
  token: string,
  spreadsheetId: string,
): Promise<Record<Coleccion, Map<string, number>>> {
  const rangos = HOJAS.map((hoja) => `ranges=${encodeURIComponent(`${hoja}!A2:A`)}`).join('&');
  const respuesta = await peticion<{ valueRanges?: { values?: string[][] }[] }>(
    `${API_SHEETS}/${spreadsheetId}/values:batchGet?${rangos}&majorDimension=COLUMNS`,
    token,
  );

  const indice = {} as Record<Coleccion, Map<string, number>>;
  HOJAS.forEach((hoja, posicion) => {
    const mapa = new Map<string, number>();
    const ids = respuesta.valueRanges?.[posicion]?.values?.[0] ?? [];
    ids.forEach((id, fila) => {
      if (id) mapa.set(id, fila + 2); // +2: la fila 1 es la cabecera y el array empieza en 0.
    });
    indice[hoja] = mapa;
  });
  return indice;
}

export interface RangoValores {
  range: string;
  values: (string | number | boolean)[][];
}

/**
 * Escribe todos los rangos en una sola llamada. `USER_ENTERED` es necesario
 * para que las fórmulas de duración y de nombre de ubicación entren como
 * fórmulas y no como texto.
 */
export async function escribeValores(
  token: string,
  spreadsheetId: string,
  datos: RangoValores[],
): Promise<void> {
  if (datos.length === 0) return;
  await peticion(`${API_SHEETS}/${spreadsheetId}/values:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: datos }),
  });
}

export function urlDocumento(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}
