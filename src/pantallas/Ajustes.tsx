import { useEffect, useState } from 'react';
import { BotonSincronizar, Cabecera } from '../ui/componentes';
import { useConsulta, useEstadoSync } from '../ui/hooks';
import { guardaAjustes, leeAjustes } from '../db/repos';
import { reintentaFallidos, todosLosElementos } from '../db/outbox';
import { conectaGoogle, vaciaCola } from '../sync/sincronizador';
import { cierraSesion, configuraCliente, obtenToken } from '../sync/google';
import { creaDocumento, existeDocumento, urlDocumento } from '../sync/drive';

/**
 * Ajustes y estado real de la sincronización.
 *
 * La hoja **la crea la app** (botón de abajo). Con scope `drive.file` la
 * aplicación solo ve ficheros que ha creado ella: una hoja hecha a mano en
 * Drive sería invisible.
 */
export function Ajustes() {
  const info = useEstadoSync();
  const { datos: ajustes } = useConsulta(leeAjustes, ['ajustes']);
  const { datos: cola } = useConsulta(todosLosElementos, ['outbox']);

  const [clientId, setClientId] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ajustes) setClientId(ajustes.google_client_id);
  }, [ajustes?.google_client_id]);

  async function conMensaje(etiqueta: string, tarea: () => Promise<void>) {
    setOcupado(etiqueta);
    setError(null);
    try {
      await tarea();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
    } finally {
      setOcupado(null);
    }
  }

  const fallidos = (cola ?? []).filter((e) => e.estado === 'fallido');

  return (
    <>
      <Cabecera titulo="Ajustes" />
      <div className="contenido">
        <div className="seccion">
          <h2>Copia en Google Sheets</h2>

          <label className="campo">
            <span>Client ID de OAuth</span>
            <input
              value={clientId}
              placeholder="…apps.googleusercontent.com"
              onChange={(evento) => setClientId(evento.target.value)}
              onBlur={() => void guardaAjustes({ google_client_id: clientId.trim() })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <button
            className="boton ancho"
            disabled={!clientId.trim() || ocupado !== null}
            onClick={() =>
              void conMensaje('conectar', async () => {
                await guardaAjustes({ google_client_id: clientId.trim() });
                await conectaGoogle();
              })
            }
          >
            {ocupado === 'conectar' ? 'Abriendo Google…' : 'Conectar con Google'}
          </button>

          {ajustes?.spreadsheet_id ? (
            <p style={{ marginTop: 16 }}>
              <a
                className="boton plano"
                href={urlDocumento(ajustes.spreadsheet_id)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir la hoja en Drive ↗
              </a>
              <br />
              <span className="suave">Id: {ajustes.spreadsheet_id}</span>
            </p>
          ) : (
            <button
              className="boton ancho"
              style={{ marginTop: 12 }}
              disabled={!clientId.trim() || ocupado !== null}
              onClick={() =>
                void conMensaje('crear', async () => {
                  await guardaAjustes({ google_client_id: clientId.trim() });
                  configuraCliente(clientId.trim());
                  const token = await obtenToken(true);
                  const id = await creaDocumento(token, 'Bitácora');
                  await guardaAjustes({ spreadsheet_id: id });
                  await vaciaCola();
                })
              }
            >
              {ocupado === 'crear' ? 'Creando…' : 'Crear la hoja de cálculo'}
            </button>
          )}

          {ajustes?.spreadsheet_id && (
            <button
              className="boton ancho"
              style={{ marginTop: 10 }}
              disabled={ocupado !== null}
              onClick={() =>
                void conMensaje('comprobar', async () => {
                  configuraCliente(ajustes.google_client_id);
                  const token = await obtenToken(true);
                  const existe = await existeDocumento(token, ajustes.spreadsheet_id);
                  if (!existe) {
                    setError('La hoja ya no está accesible. Crea una nueva desde aquí.');
                    await guardaAjustes({ spreadsheet_id: '' });
                  }
                })
              }
            >
              {ocupado === 'comprobar' ? 'Comprobando…' : 'Comprobar acceso a la hoja'}
            </button>
          )}

          {error && <p className="aviso rojo">{error}</p>}

          <p className="suave" style={{ marginTop: 16 }}>
            La hoja tiene que crearla la app: con el permiso <code>drive.file</code> solo ve los
            ficheros que ha creado ella. Los datos viven en el móvil; Drive es la copia.
          </p>
        </div>

        <div className="seccion">
          <h2>Cola de envío</h2>
          <p>
            {info.pendientes} pendientes · {info.fallidos} con error
          </p>
          {info.mensaje && <p className="suave">{info.mensaje}</p>}
          <div className="fila-botones">
            <BotonSincronizar />
            {fallidos.length > 0 && (
              <button
                className="boton"
                onClick={async () => {
                  await reintentaFallidos();
                  await vaciaCola();
                }}
              >
                Reintentar los fallidos
              </button>
            )}
          </div>

          {fallidos.length > 0 && (
            <ul className="lista" style={{ marginTop: 12 }}>
              {fallidos.map((elemento) => (
                <li className="tarjeta" key={elemento.id}>
                  <strong>{elemento.coleccion}</strong>
                  <div className="suave">{elemento.ultimo_error}</div>
                  <div className="suave">{elemento.intentos} intentos</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="seccion">
          <h2>Jornadas olvidadas</h2>
          <label className="campo">
            <span>Avisar tras (horas)</span>
            <input
              type="number"
              min={1}
              max={48}
              value={ajustes?.horas_aviso_jornada_abierta ?? 12}
              onChange={(evento) =>
                void guardaAjustes({
                  horas_aviso_jornada_abierta: Math.max(1, Number(evento.target.value) || 12),
                })
              }
            />
          </label>
          <p className="suave">
            Pasado ese tiempo la app avisa y propone cerrar la jornada. No la cierra sola: una hora
            inventada en un parte es peor que una jornada abierta.
          </p>
        </div>

        <div className="seccion">
          <h2>Sesión</h2>
          <button
            className="boton ancho"
            onClick={() => void conMensaje('salir', () => cierraSesion())}
          >
            Cerrar sesión de Google
          </button>
          <p className="suave">
            Los datos no se van a ninguna parte: siguen en el móvil, que es la fuente de verdad.
          </p>
        </div>
      </div>
    </>
  );
}
