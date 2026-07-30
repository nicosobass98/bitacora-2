import { useMemo, useState } from 'react';
import { Cabecera } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { navega } from '../ui/router';
import {
  jornadasPorCompletar,
  jornadasPorFecha,
  leeAjustes,
  todasLasJornadas,
  todasLasUbicaciones,
} from '../db/repos';
import { urlDocumento } from '../sync/drive';
import { formateaDuracion, duracionMinutos, formateaFechaCorta, horaDe, hoy } from '../domain/tiempo';
import {
  ETIQUETA_ESTADO_JORNADA,
  ETIQUETA_MOTIVO,
  MOTIVOS,
  type Jornada,
  type Ubicacion,
} from '../domain/tipos';

/** Fila de jornada reutilizada por historial, día y ficha de ubicación. */
export function FilaJornada({
  jornada,
  ubicacion,
  mostrarFecha = true,
}: {
  jornada: Jornada;
  ubicacion?: Ubicacion | undefined;
  mostrarFecha?: boolean;
}) {
  return (
    <button className="tarjeta pulsable" onClick={() => navega(`/jornada/${jornada.id}`)}>
      <strong>{ubicacion?.nombre ?? 'Sin asignar'}</strong>
      <div className="linea-meta">
        {mostrarFecha && <span>{formateaFechaCorta(jornada.fecha)}</span>}
        <span>
          {horaDe(jornada.hora_inicio)}
          {jornada.hora_fin ? `–${horaDe(jornada.hora_fin)}` : ''}
        </span>
        <span>{formateaDuracion(duracionMinutos(jornada.hora_inicio, jornada.hora_fin))}</span>
        {jornada.motivo && <span>{ETIQUETA_MOTIVO[jornada.motivo]}</span>}
        {jornada.estado !== 'cerrada' && (
          <span className={`etiqueta-pastilla ${jornada.estado === 'incompleta' ? 'aviso' : ''}`}>
            {ETIQUETA_ESTADO_JORNADA[jornada.estado]}
          </span>
        )}
      </div>
      {jornada.notas && <div className="suave">{jornada.notas.split('\n')[0]}</div>}
    </button>
  );
}

/** §5.7 — Lista por fecha, filtros por ubicación y motivo, enlace a la hoja. */
export function Historial() {
  const [filtroUbicacion, setFiltroUbicacion] = useState('');
  const [filtroMotivo, setFiltroMotivo] = useState('');

  const { datos } = useConsulta(
    async () => {
      const [jornadas, ubicaciones, ajustes] = await Promise.all([
        todasLasJornadas(),
        todasLasUbicaciones(),
        leeAjustes(),
      ]);
      return { jornadas, ubicaciones, ajustes };
    },
    ['jornadas', 'ubicaciones', 'ajustes'],
  );

  const porId = useMemo(
    () => new Map((datos?.ubicaciones ?? []).map((u) => [u.id, u])),
    [datos?.ubicaciones],
  );

  const filtradas = useMemo(() => {
    let jornadas = datos?.jornadas ?? [];
    if (filtroUbicacion) jornadas = jornadas.filter((j) => j.ubicacion_id === filtroUbicacion);
    if (filtroMotivo) jornadas = jornadas.filter((j) => j.motivo === filtroMotivo);
    return jornadas;
  }, [datos?.jornadas, filtroUbicacion, filtroMotivo]);

  const porFecha = useMemo(() => {
    const grupos = new Map<string, Jornada[]>();
    for (const jornada of filtradas) {
      const grupo = grupos.get(jornada.fecha) ?? [];
      grupo.push(jornada);
      grupos.set(jornada.fecha, grupo);
    }
    return [...grupos.entries()];
  }, [filtradas]);

  return (
    <>
      <Cabecera
        titulo="Historial"
        volver={false}
        accion={
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="boton plano" onClick={() => navega('/dia')}>
              Por día
            </button>
            <button className="boton plano" onClick={() => navega('/parte')}>
              Parte semanal
            </button>
          </div>
        }
      />
      <div className="contenido">
        <div className="rejilla-botones" style={{ marginBottom: 16 }}>
          <select
            value={filtroUbicacion}
            onChange={(evento) => setFiltroUbicacion(evento.target.value)}
          >
            <option value="">Todos los sitios</option>
            {(datos?.ubicaciones ?? [])
              .slice()
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
              .map((ubicacion) => (
                <option key={ubicacion.id} value={ubicacion.id}>
                  {ubicacion.nombre}
                </option>
              ))}
          </select>
          <select value={filtroMotivo} onChange={(evento) => setFiltroMotivo(evento.target.value)}>
            <option value="">Todos los motivos</option>
            {MOTIVOS.map((motivo) => (
              <option key={motivo} value={motivo}>
                {ETIQUETA_MOTIVO[motivo]}
              </option>
            ))}
          </select>
        </div>

        {porFecha.length === 0 ? (
          <p className="vacio">Todavía no hay jornadas registradas.</p>
        ) : (
          porFecha.map(([fecha, jornadas]) => (
            <div className="seccion" key={fecha}>
              <h2>{formateaFechaCorta(fecha)}</h2>
              <ul className="lista">
                {jornadas.map((jornada) => (
                  <li key={jornada.id}>
                    <FilaJornada
                      jornada={jornada}
                      ubicacion={jornada.ubicacion_id ? porId.get(jornada.ubicacion_id) : undefined}
                      mostrarFecha={false}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {datos?.ajustes.spreadsheet_id && (
          <p style={{ marginTop: 24 }}>
            <a
              className="boton plano"
              href={urlDocumento(datos.ajustes.spreadsheet_id)}
              target="_blank"
              rel="noreferrer"
            >
              Abrir la hoja en Drive ↗
            </a>
          </p>
        )}
      </div>
    </>
  );
}

/** §5.4 — Las jornadas que son agujeros en el histórico, en un sitio. */
export function Completar() {
  const { datos } = useConsulta(
    async () => {
      const [jornadas, ubicaciones] = await Promise.all([
        jornadasPorCompletar(),
        todasLasUbicaciones(),
      ]);
      return { jornadas, ubicaciones };
    },
    ['jornadas', 'ubicaciones'],
  );

  const porId = new Map((datos?.ubicaciones ?? []).map((u) => [u.id, u]));

  return (
    <>
      <Cabecera titulo="Por completar" />
      <div className="contenido">
        <p className="suave">
          Sin sitio o sin motivo, una jornada no aparece en las búsquedas. Aquí se arreglan.
        </p>
        {(datos?.jornadas.length ?? 0) === 0 ? (
          <p className="vacio">Nada pendiente. El histórico está entero.</p>
        ) : (
          <ul className="lista">
            {datos?.jornadas.map((jornada) => (
              <li key={jornada.id}>
                <FilaJornada
                  jornada={jornada}
                  ubicacion={jornada.ubicacion_id ? porId.get(jornada.ubicacion_id) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** §5.6, segunda dirección — fecha → sitio. */
export function Dia({ fecha }: { fecha?: string }) {
  const [dia, setDia] = useState(fecha ?? hoy());

  const { datos } = useConsulta(
    async () => {
      const [jornadas, ubicaciones] = await Promise.all([
        jornadasPorFecha(dia),
        todasLasUbicaciones(),
      ]);
      return { jornadas, ubicaciones };
    },
    ['jornadas', 'ubicaciones'],
    [dia],
  );

  const porId = new Map((datos?.ubicaciones ?? []).map((u) => [u.id, u]));

  return (
    <>
      <Cabecera titulo="¿Dónde estuve?" />
      <div className="contenido">
        <label className="campo">
          <span>Día</span>
          <input type="date" value={dia} onChange={(evento) => setDia(evento.target.value)} />
        </label>

        {(datos?.jornadas.length ?? 0) === 0 ? (
          <p className="vacio">Ninguna jornada ese día.</p>
        ) : (
          <ul className="lista">
            {datos?.jornadas.map((jornada) => (
              <li key={jornada.id}>
                <FilaJornada
                  jornada={jornada}
                  ubicacion={jornada.ubicacion_id ? porId.get(jornada.ubicacion_id) : undefined}
                  mostrarFecha={false}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
