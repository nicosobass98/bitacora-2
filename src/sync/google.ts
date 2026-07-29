/**
 * Autenticación con Google (§2).
 *
 * Se usa Google Identity Services en el navegador real —no hay WebView, no hay
 * Capacitor— así que no aparece el bloqueo `disallowed_useragent`.
 *
 * Un único scope: `drive.file`. Es «no sensible» y solo exige verificación
 * básica. Consecuencia que hay que tener presente: la app solo ve ficheros que
 * ella misma ha creado, de modo que **la hoja de cálculo la crea la app**. Una
 * hoja creada a mano en Drive es invisible para esta aplicación.
 *
 * El token de acceso vive en memoria y nunca se persiste: un refresh token en
 * `localStorage` sería un riesgo sin ninguna ventaja para un uso personal.
 */

export const SCOPE_DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const URL_GIS = 'https://accounts.google.com/gsi/client';

interface RespuestaToken {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface ClienteToken {
  requestAccessToken(opciones?: { prompt?: string }): void;
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        callback: (respuesta: RespuestaToken) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): ClienteToken;
      revoke(token: string, hecho: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

export class ErrorAutenticacion extends Error {
  /** `true` cuando hace falta que el usuario intervenga (no sirve reintentar solo). */
  readonly requiereUsuario: boolean;

  constructor(mensaje: string, requiereUsuario = true) {
    super(mensaje);
    this.name = 'ErrorAutenticacion';
    this.requiereUsuario = requiereUsuario;
  }
}

let promesaScript: Promise<GoogleGlobal> | null = null;

function cargaGIS(): Promise<GoogleGlobal> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (promesaScript) return promesaScript;

  promesaScript = new Promise<GoogleGlobal>((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = URL_GIS;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolver(window.google);
      else rechazar(new ErrorAutenticacion('Google Identity no se ha inicializado', false));
    };
    script.onerror = () => {
      promesaScript = null;
      rechazar(new ErrorAutenticacion('Sin red: no se ha podido cargar Google Identity', false));
    };
    document.head.appendChild(script);
  });
  return promesaScript;
}

let clienteId = '';
let cliente: ClienteToken | null = null;
let token: string | null = null;
let caducaEn = 0;
let peticionEnCurso: {
  resolver: (token: string) => void;
  rechazar: (error: unknown) => void;
} | null = null;

/** Margen de seguridad: se renueva antes de que caduque de verdad. */
const MARGEN_MS = 60_000;

export function configuraCliente(id: string): void {
  if (id !== clienteId) {
    clienteId = id;
    cliente = null;
    token = null;
    caducaEn = 0;
  }
}

export function haySesion(): boolean {
  return token !== null && Date.now() < caducaEn - MARGEN_MS;
}

export function olvidaToken(): void {
  token = null;
  caducaEn = 0;
}

async function obtenCliente(): Promise<ClienteToken> {
  if (!clienteId) {
    throw new ErrorAutenticacion('Falta el Client ID de Google. Configúralo en Ajustes.');
  }
  if (cliente) return cliente;

  const google = await cargaGIS();
  cliente = google.accounts.oauth2.initTokenClient({
    client_id: clienteId,
    scope: SCOPE_DRIVE_FILE,
    callback: (respuesta) => {
      const pendiente = peticionEnCurso;
      peticionEnCurso = null;
      if (!pendiente) return;
      if (respuesta.access_token) {
        token = respuesta.access_token;
        caducaEn = Date.now() + (respuesta.expires_in ?? 3600) * 1000;
        pendiente.resolver(respuesta.access_token);
      } else {
        pendiente.rechazar(
          new ErrorAutenticacion(respuesta.error_description ?? respuesta.error ?? 'Acceso denegado'),
        );
      }
    },
    error_callback: (error) => {
      const pendiente = peticionEnCurso;
      peticionEnCurso = null;
      pendiente?.rechazar(new ErrorAutenticacion(error.message ?? 'Ventana de acceso cerrada'));
    },
  });
  return cliente;
}

/**
 * Devuelve un token de acceso válido.
 *
 * `interactivo = false` intenta renovar en silencio; si Google necesita mostrar
 * la ventana, falla con `requiereUsuario`. Eso es deliberado: el vaciado de la
 * cola corre en segundo plano y jamás debe abrir una ventana emergente por su
 * cuenta.
 */
export function obtenToken(interactivo = false): Promise<string> {
  if (haySesion() && token) return Promise.resolve(token);

  return new Promise<string>((resolver, rechazar) => {
    void obtenCliente()
      .then((clienteToken) => {
        if (peticionEnCurso) {
          rechazar(new ErrorAutenticacion('Ya hay una petición de acceso en curso', false));
          return;
        }
        peticionEnCurso = { resolver, rechazar };
        clienteToken.requestAccessToken({ prompt: interactivo ? 'consent' : '' });
      })
      .catch(rechazar);
  });
}

/** Pide acceso mostrando la ventana de Google. Solo desde un gesto del usuario. */
export function iniciaSesion(): Promise<string> {
  return obtenToken(true);
}

export async function cierraSesion(): Promise<void> {
  const actual = token;
  olvidaToken();
  if (!actual) return;
  const google = await cargaGIS().catch(() => null);
  await new Promise<void>((resolver) => {
    if (!google) return resolver();
    google.accounts.oauth2.revoke(actual, resolver);
  });
}
