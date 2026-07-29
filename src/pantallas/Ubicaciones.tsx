import { useMemo, useState } from 'react';
import { Cabecera } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { navega } from '../ui/router';
import {
  creaUbicacion,
  guardaUbicacion,
  jornadasPorUbicacion,
  notasPorUbicacion,
  obtenUbicacion,
  ubicacionesPorUsoReciente,
} from '../db/repos';
import { fechaDe, formateaFechaCorta, horaDe } from '../domain/tiempo';
import {
  ETIQUETA_MOTIVO,
  ETIQUETA_SISTEMA,
  type Jornada,
  type Nota,
  type Ubicacion,
} from '../domain/tipos';

export function Ubicaciones() {
  const [busqueda, setBusqueda] = useState('');
  const { datos } = useConsulta(ubicacionesPorUsoReciente, ['ubicaciones']);

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    const ubicaciones = datos ?? [];
    if (!texto) return ubicaciones;
    return ubicaciones.filter(
      (u) => u.nombre.toLowerCase().includes(texto) || u.cliente.toLowerCase().includes(texto),
    );
  }, [datos, busqueda]);

  const nombreExacto = filtradas.some(
    (u) => u.nombre.toLowerCase() === busqueda.trim().toLowerCase(),
  );

  return (
    <>
      <Cabecera titulo="Sitios" volver={false} />
      <div className="contenido">
        <label className="campo">
          <span>Buscar</span>
          <input
            type="search"
            value={busqueda}
            placeholder="Nombre o cliente"
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </label>

        {busqueda.trim() && !nombreExacto && (
          <button
            className="boton ancho"
            onClick={async () => {
              const ubicacion = await creaUbicacion({ nombre: busqueda.trim() });
              setBusqueda('');
              navega(`/ubicacion/${ubicacion.id}`);
            }}
          >
            Crear «{busqueda.trim()}»
          </button>
        )}

        {filtradas.length === 0 ? (
          <p className="vacio">
            La lista de sitios la construyes tú. Crece solo cuando creas una entrada.
          </p>
        ) : (
          <ul className="lista" style={{ marginTop: 16 }}>
            {filtradas.map((ubicacion) => (
              <li key={ubicacion.id}>
                <button
                  className="tarjeta pulsable"
                  onClick={() => navega(`/ubicacion/${ubicacion.id}`)}
                >
                  <strong>{ubicacion.nombre}</strong>
                  {ubicacion.cliente && <div className="suave">{ubicacion.cliente}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

type Entrada =
  | { clase: 'jornada'; instante: string; jornada: Jornada }
  | { clase: 'nota'; instante: string; nota: Nota };

/**
 * §5.6, primera dirección — sitio → fechas.
 *
 * Una sola línea de tiempo que mezcla visitas y notas ordenadas por fecha. No
 * son dos listas: cuando se busca «qué pasó en esta nave», la nota del viernes
 * sobre el problema del miércoles importa tanto como la visita.
 */
export function FichaUbicacion({ id }: { id: string }) {
  const { datos, cargando } = useConsulta(
    async () => {
      const ubicacion = await obtenUbicacion(id);
      if (!ubicacion) return { ubicacion: undefined, entradas: [] as Entrada[] };
      const [jornadas, notas] = await Promise.all([
        jornadasPorUbicacion(id),
        notasPorUbicacion(id),
      ]);
      const entradas: Entrada[] = [
        ...jornadas.map((jornada) => ({
          clase: 'jornada' as const,
          instante: jornada.hora_inicio,
          jornada,
        })),
        ...notas.map((nota) => ({ clase: 'nota' as const, instante: nota.creado_en, nota })),
      ].sort((a, b) => b.instante.localeCompare(a.instante));
      return { ubicacion, entradas };
    },
    ['jornadas', 'notas', 'ubicaciones'],
    [id],
  );

  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Ubicacion | null>(null);

  if (cargando) return <div className="contenido" />;
  if (!datos?.ubicacion) {
    return (
      <>
        <Cabecera titulo="Sitio" />
        <p className="vacio">Este sitio ya no existe.</p>
      </>
    );
  }

  const ubicacion = datos.ubicacion;
  const enEdicion = borrador ?? ubicacion;

  return (
    <>
      <Cabecera
        titulo={ubicacion.nombre}
        accion={
          <button
            className="boton plano"
            onClick={() => {
              setBorrador(ubicacion);
              setEditando((valor) => !valor);
            }}
          >
            {editando ? 'Cerrar' : 'Editar'}
          </button>
        }
      />
      <div className="contenido">
        {editando ? (
          <>
            <label className="campo">
              <span>Nombre</span>
              <input
                value={enEdicion.nombre}
                onChange={(evento) =>
                  setBorrador({ ...enEdicion, nombre: evento.target.value })
                }
              />
            </label>
            <label className="campo">
              <span>Cliente</span>
              <input
                value={enEdicion.cliente}
                onChange={(evento) =>
                  setBorrador({ ...enEdicion, cliente: evento.target.value })
                }
              />
            </label>
            <label className="campo">
              <span>Dirección</span>
              <input
                value={enEdicion.direccion}
                onChange={(evento) =>
                  setBorrador({ ...enEdicion, direccion: evento.target.value })
                }
              />
            </label>
            <label className="campo">
              <span>Notas de acceso</span>
              <textarea
                value={enEdicion.notas_acceso}
                placeholder="Dónde aparcar, con quién hablar, dónde está el cuadro…"
                onChange={(evento) =>
                  setBorrador({ ...enEdicion, notas_acceso: evento.target.value })
                }
              />
            </label>
            <button
              className="boton primario ancho"
              onClick={async () => {
                await guardaUbicacion(enEdicion);
                setEditando(false);
                setBorrador(null);
              }}
            >
              Guardar
            </button>
          </>
        ) : (
          <>
            {(ubicacion.cliente || ubicacion.direccion || ubicacion.notas_acceso) && (
              <div className="tarjeta">
                {ubicacion.cliente && <div>{ubicacion.cliente}</div>}
                {ubicacion.direccion && <div className="suave">{ubicacion.direccion}</div>}
                {ubicacion.notas_acceso && (
                  <p style={{ marginBottom: 0 }}>{ubicacion.notas_acceso}</p>
                )}
              </div>
            )}

            <div className="seccion">
              <h2>Línea de tiempo</h2>
              {datos.entradas.length === 0 ? (
                <p className="vacio">Sin visitas ni notas todavía.</p>
              ) : (
                <ul className="linea-tiempo">
                  {datos.entradas.map((entrada) =>
                    entrada.clase === 'jornada' ? (
                      <li key={entrada.jornada.id}>
                        <button
                          className="boton plano"
                          onClick={() => navega(`/jornada/${entrada.jornada.id}`)}
                        >
                          <strong>{formateaFechaCorta(entrada.jornada.fecha)}</strong>
                          {entrada.jornada.motivo &&
                            ` — ${ETIQUETA_MOTIVO[entrada.jornada.motivo].toLowerCase()}`}
                          {entrada.jornada.sistema &&
                            ` (${ETIQUETA_SISTEMA[entrada.jornada.sistema]})`}
                        </button>
                        <div className="suave">
                          {horaDe(entrada.jornada.hora_inicio)}
                          {entrada.jornada.hora_fin ? `–${horaDe(entrada.jornada.hora_fin)}` : ''}
                          {entrada.jornada.notas ? ` · ${entrada.jornada.notas}` : ''}
                        </div>
                      </li>
                    ) : (
                      <li key={entrada.nota.id} className="es-nota">
                        <button
                          className="boton plano"
                          onClick={() => navega(`/nota/${entrada.nota.id}`)}
                        >
                          <strong>{formateaFechaCorta(fechaDe(entrada.nota.creado_en))}</strong> —
                          nota: {entrada.nota.texto.split('\n')[0]}
                        </button>
                        {entrada.nota.estado === 'pendiente' && entrada.nota.fecha_aviso && (
                          <div>
                            <span className="etiqueta-pastilla aviso">
                              Aviso {formateaFechaCorta(fechaDe(entrada.nota.fecha_aviso))}
                            </span>
                          </div>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
