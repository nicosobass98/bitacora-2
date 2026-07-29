import { EstadoSincronizacion } from '../ui/componentes';
import { useConsulta, useMinuto } from '../ui/hooks';
import { navega } from '../ui/router';
import {
  jornadaAbierta,
  jornadasPorCompletar,
  leeAjustes,
  obtenUbicacion,
  pendientesDeHoy,
} from '../db/repos';
import { formateaDuracion, horaDe, horasDesde, duracionMinutos, ahora } from '../domain/tiempo';

/**
 * §5.1 — Una sola acción dominante, que cambia según el estado. Todo lo demás
 * va debajo y en pequeño: si hay que elegir entre dos botones grandes, ya se ha
 * perdido la partida de «uno o dos toques sin pensar».
 */
export function Inicio() {
  const tic = useMinuto();

  const { datos } = useConsulta(
    async () => {
      const abierta = await jornadaAbierta();
      const [ubicacion, porCompletar, pendientes, ajustes] = await Promise.all([
        abierta?.ubicacion_id ? obtenUbicacion(abierta.ubicacion_id) : Promise.resolve(undefined),
        jornadasPorCompletar(),
        pendientesDeHoy(),
        leeAjustes(),
      ]);
      return { abierta, ubicacion, porCompletar, pendientes, ajustes };
    },
    ['jornadas', 'notas', 'ubicaciones', 'ajustes'],
    [tic],
  );

  if (!datos) return <div className="contenido" />;

  const { abierta, ubicacion, porCompletar, pendientes, ajustes } = datos;
  const horasAbierta = abierta ? horasDesde(abierta.hora_inicio) : 0;
  const olvidada = abierta !== undefined && horasAbierta >= ajustes.horas_aviso_jornada_abierta;

  return (
    <div className="contenido">
      {/*
        §7 — Si una jornada lleva demasiado abierta se avisa y se propone
        cerrarla, pero la hora la ajusta el usuario. Cerrarla sola inventándose
        la hora metería datos falsos en los partes.
      */}
      {olvidada && abierta && (
        <div className="aviso">
          <h3>Jornada abierta desde hace {Math.floor(horasAbierta)} h</h3>
          <p className="suave">
            Empezó el {abierta.fecha} a las {horaDe(abierta.hora_inicio)}. Ciérrala tú con la hora
            real: la app no se la inventa.
          </p>
          <button className="boton ancho" onClick={() => navega('/jornada/cerrar')}>
            Revisar y cerrar
          </button>
        </div>
      )}

      {abierta ? (
        <button className="accion-dominante cerrar" onClick={() => navega('/jornada/cerrar')}>
          CERRAR JORNADA
          <span className="subtitulo">
            {ubicacion?.nombre ?? 'Sin asignar'} · desde las {horaDe(abierta.hora_inicio)}
            {' · '}
            {formateaDuracion(duracionMinutos(abierta.hora_inicio, ahora()))}
          </span>
        </button>
      ) : (
        <button className="accion-dominante" onClick={() => navega('/jornada/abrir')}>
          ABRIR JORNADA
          <span className="subtitulo">Sitio y motivo. La hora se pone sola.</span>
        </button>
      )}

      <div className="seccion">
        <h2>Pendientes de hoy</h2>
        {pendientes.length === 0 ? (
          <p className="suave">Nada para hoy.</p>
        ) : (
          <ul className="lista">
            {pendientes.slice(0, 5).map((nota) => (
              <li key={nota.id}>
                <button className="tarjeta pulsable" onClick={() => navega(`/nota/${nota.id}`)}>
                  {nota.texto.split('\n')[0]}
                  <div className="linea-meta">
                    <span>{horaDe(nota.fecha_aviso)}</span>
                    {!nota.enviado_a_calendario && (
                      <span className="etiqueta-pastilla aviso">Sin calendario</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="seccion">
        {/*
          §5.4 — El contador no es decorativo: estas jornadas no aparecen en
          ninguna de las dos búsquedas. Son agujeros en el histórico.
        */}
        {porCompletar.length > 0 ? (
          <button className="boton ancho" onClick={() => navega('/completar')}>
            {porCompletar.length}{' '}
            {porCompletar.length === 1 ? 'jornada por completar' : 'jornadas por completar'}
          </button>
        ) : (
          <p className="suave">Ninguna jornada por completar.</p>
        )}
        <EstadoSincronizacion />
      </div>
    </div>
  );
}
