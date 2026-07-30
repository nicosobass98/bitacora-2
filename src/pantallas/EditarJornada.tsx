import { useEffect, useState } from 'react';
import { Cabecera, Confirmacion, SelectorUbicacion } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { atras, navega } from '../ui/router';
import { borraJornada, guardaJornada, obtenJornada, notasPorJornada } from '../db/repos';
import {
  aInputDateTime,
  desdeInputDateTime,
  duracionMinutos,
  formateaDuracion,
  formateaFechaCorta,
} from '../domain/tiempo';
import {
  ETIQUETA_MOTIVO,
  ETIQUETA_SISTEMA,
  ETIQUETA_TIPO_HORAS,
  MOTIVOS,
  SISTEMAS,
  TIPOS_HORAS,
  type Jornada,
  type Motivo,
  type Sistema,
  type TipoHoras,
} from '../domain/tipos';

/**
 * §5.4 — Completar en frío lo que se capturó en campo. Separar el momento de
 * capturar del de detallar es lo que hace que el sistema aguante.
 */
export function EditarJornada({ id }: { id: string }) {
  const { datos, cargando } = useConsulta(
    async () => {
      const jornada = await obtenJornada(id);
      const notas = jornada ? await notasPorJornada(jornada.id) : [];
      return { jornada, notas };
    },
    ['jornadas', 'notas'],
    [id],
  );

  const [borrador, setBorrador] = useState<Jornada | null>(null);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (datos?.jornada && !borrador) setBorrador(datos.jornada);
  }, [datos?.jornada, borrador]);

  if (cargando) return <div className="contenido" />;
  if (!datos?.jornada || !borrador) {
    return (
      <>
        <Cabecera titulo="Jornada" />
        <p className="vacio">Esta jornada ya no existe.</p>
      </>
    );
  }

  const minutos = duracionMinutos(borrador.hora_inicio, borrador.hora_fin);
  const finAntesDeInicio = minutos !== null && minutos < 0;

  function cambia(cambios: Partial<Jornada>) {
    setBorrador((actual) => (actual ? { ...actual, ...cambios } : actual));
  }

  async function guardar() {
    if (!borrador || finAntesDeInicio || guardando) return;
    setGuardando(true);
    await guardaJornada(borrador);
    atras();
  }

  return (
    <>
      <Cabecera titulo={formateaFechaCorta(borrador.fecha)} />
      <div className="contenido">
        <label className="campo">
          <span>Sitio</span>
          <SelectorUbicacion
            valor={borrador.ubicacion_id}
            onSelecciona={(ubicacion) => cambia({ ubicacion_id: ubicacion?.id ?? null })}
          />
        </label>

        <div className="campo">
          <span>Motivo</span>
          <div className="rejilla-botones">
            {MOTIVOS.map((opcion) => (
              <button
                key={opcion}
                className="boton"
                aria-pressed={borrador.motivo === opcion}
                onClick={() =>
                  cambia({ motivo: borrador.motivo === opcion ? null : (opcion as Motivo) })
                }
              >
                {ETIQUETA_MOTIVO[opcion]}
              </button>
            ))}
          </div>
        </div>

        <div className="campo">
          <span>Sistema</span>
          <div className="rejilla-botones">
            {SISTEMAS.map((opcion) => (
              <button
                key={opcion}
                className="boton"
                aria-pressed={borrador.sistema === opcion}
                onClick={() =>
                  cambia({ sistema: borrador.sistema === opcion ? null : (opcion as Sistema) })
                }
              >
                {ETIQUETA_SISTEMA[opcion]}
              </button>
            ))}
          </div>
        </div>

        <div className="campo">
          <span>Horas</span>
          <div className="rejilla-botones">
            {TIPOS_HORAS.map((opcion) => (
              <button
                key={opcion}
                className="boton"
                aria-pressed={borrador.tipo_horas === opcion}
                onClick={() => cambia({ tipo_horas: opcion as TipoHoras })}
              >
                {ETIQUETA_TIPO_HORAS[opcion]}
              </button>
            ))}
          </div>
          <p className="suave">
            {borrador.tipo_horas === 'guardia'
              ? 'Cuenta como mínimo el umbral de guardia de Ajustes, aunque haya durado menos.'
              : 'Las horas extra se calculan solas comparando con tu horario habitual (Ajustes).'}
          </p>
        </div>

        <label className="campo">
          <span>Inicio</span>
          <input
            type="datetime-local"
            value={aInputDateTime(borrador.hora_inicio)}
            onChange={(evento) => {
              const instante = desdeInputDateTime(evento.target.value);
              if (instante) cambia({ hora_inicio: instante });
            }}
          />
        </label>

        <label className="campo">
          <span>Fin</span>
          <input
            type="datetime-local"
            value={aInputDateTime(borrador.hora_fin)}
            onChange={(evento) => cambia({ hora_fin: desdeInputDateTime(evento.target.value) })}
          />
        </label>

        <p className="suave">Duración: {formateaDuracion(minutos)}</p>
        {finAntesDeInicio && <p className="aviso rojo">El fin es anterior al inicio.</p>}

        <label className="campo">
          <span>Descripción</span>
          <textarea
            value={borrador.descripcion}
            placeholder="Qué se ha hecho — esto es lo que sale en el parte."
            onChange={(evento) => cambia({ descripcion: evento.target.value })}
          />
        </label>

        <label className="campo">
          <span>Notas privadas</span>
          <textarea
            value={borrador.notas}
            placeholder="Para ti. Nunca aparece en el parte."
            onChange={(evento) => cambia({ notas: evento.target.value })}
          />
        </label>

        {datos.notas.length > 0 && (
          <div className="seccion">
            <h2>Notas de esta jornada</h2>
            <ul className="lista">
              {datos.notas.map((nota) => (
                <li key={nota.id}>
                  <button className="tarjeta pulsable" onClick={() => navega(`/nota/${nota.id}`)}>
                    {nota.texto}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="fila-botones">
          <button className="boton peligro" onClick={() => setConfirmandoBorrado(true)}>
            Borrar
          </button>
          <button
            className="boton primario"
            disabled={guardando || finAntesDeInicio}
            onClick={() => void guardar()}
          >
            Guardar
          </button>
        </div>
      </div>

      {confirmandoBorrado && (
        <Confirmacion
          titulo="¿Borrar esta jornada?"
          detalle="Se borra del móvil. La fila que ya esté en la hoja de Drive no se elimina sola."
          onCancelar={() => setConfirmandoBorrado(false)}
          onConfirmar={async () => {
            await borraJornada(borrador.id);
            navega('/historial', true);
          }}
        />
      )}
    </>
  );
}
