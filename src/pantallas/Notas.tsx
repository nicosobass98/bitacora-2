import { useEffect, useState } from 'react';
import { Cabecera, Confirmacion, SelectorUbicacion } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { atras, navega } from '../ui/router';
import {
  borraNota,
  creaNota,
  guardaNota,
  jornadaAbierta,
  obtenNota,
  obtenUbicacion,
  todasLasNotas,
  todasLasUbicaciones,
} from '../db/repos';
import { entregaICS } from '../ics/ics';
import { aInputDateTime, desdeInputDateTime, fechaDe, formateaFechaCorta, horaDe } from '../domain/tiempo';
import type { Nota } from '../domain/tipos';

/** Bandeja de notas. Los recordatorios sin calendario van destacados (§6). */
export function Notas() {
  const { datos } = useConsulta(
    async () => {
      const [notas, ubicaciones] = await Promise.all([todasLasNotas(), todasLasUbicaciones()]);
      return { notas, ubicaciones };
    },
    ['notas', 'ubicaciones'],
  );

  const porId = new Map((datos?.ubicaciones ?? []).map((u) => [u.id, u]));
  const notas = datos?.notas ?? [];
  const sinCalendario = notas.filter(
    (n) => n.fecha_aviso && !n.enviado_a_calendario && n.estado === 'pendiente',
  );

  return (
    <>
      <Cabecera titulo="Notas" volver={false} />
      <div className="contenido">
        {sinCalendario.length > 0 && (
          <div className="aviso">
            <h3>{sinCalendario.length} con aviso sin confirmar en el calendario</h3>
            <p className="suave">
              Confiar en un recordatorio que no existe es peor que no tener recordatorio. Ábrelas y
              añade el evento.
            </p>
          </div>
        )}

        {notas.length === 0 ? (
          <p className="vacio">Sin notas. El botón + funciona desde cualquier pantalla.</p>
        ) : (
          <ul className="lista">
            {notas.map((nota) => (
              <li key={nota.id}>
                <button className="tarjeta pulsable" onClick={() => navega(`/nota/${nota.id}`)}>
                  <div style={{ opacity: nota.estado === 'hecha' ? 0.55 : 1 }}>
                    {nota.texto.split('\n')[0]}
                  </div>
                  <div className="linea-meta">
                    <span>{formateaFechaCorta(fechaDe(nota.creado_en))}</span>
                    {nota.ubicacion_id && porId.has(nota.ubicacion_id) && (
                      <span>{porId.get(nota.ubicacion_id)?.nombre}</span>
                    )}
                    {nota.etiqueta && <span className="etiqueta-pastilla">{nota.etiqueta}</span>}
                    {nota.fecha_aviso && (
                      <span
                        className={`etiqueta-pastilla ${nota.enviado_a_calendario ? '' : 'aviso'}`}
                      >
                        Aviso {formateaFechaCorta(fechaDe(nota.fecha_aviso))}{' '}
                        {horaDe(nota.fecha_aviso)}
                      </span>
                    )}
                    {nota.estado === 'hecha' && <span className="etiqueta-pastilla">Hecha</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** §5.5 — Un campo de texto y listo. Todo lo demás es opcional. */
export function NuevaNota() {
  const [texto, setTexto] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [aviso, setAviso] = useState('');
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [detalles, setDetalles] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Si hay jornada abierta, la nota hereda su sitio salvo que se elija otro.
  const { datos: contexto } = useConsulta(
    async () => {
      const abierta = await jornadaAbierta();
      const ubicacion = abierta?.ubicacion_id ? await obtenUbicacion(abierta.ubicacion_id) : null;
      return { abierta, ubicacion };
    },
    ['jornadas'],
  );

  async function guardar() {
    if (!texto.trim() || guardando) return;
    setGuardando(true);
    const nota = await creaNota({
      texto,
      etiqueta,
      fecha_aviso: desdeInputDateTime(aviso),
      ubicacion_id: ubicacionId,
    });
    // Con aviso, se va a la ficha para ofrecer el .ics: la nota no sirve de nada
    // si el recordatorio se queda sin crear.
    if (nota.fecha_aviso) navega(`/nota/${nota.id}`, true);
    else atras();
  }

  return (
    <>
      <Cabecera titulo="Nueva nota" />
      <div className="contenido">
        <label className="campo">
          <span>Nota</span>
          <textarea
            autoFocus
            value={texto}
            placeholder="Falta tubo de 25…"
            onChange={(evento) => setTexto(evento.target.value)}
          />
        </label>

        <button
          className="boton primario ancho"
          disabled={!texto.trim() || guardando}
          onClick={() => void guardar()}
        >
          Guardar
        </button>

        {contexto?.abierta && !ubicacionId && (
          <p className="suave" style={{ marginTop: 12 }}>
            Se archivará en la jornada abierta
            {contexto.ubicacion ? ` de ${contexto.ubicacion.nombre}` : ''}.
          </p>
        )}

        <button className="boton plano" onClick={() => setDetalles((valor) => !valor)}>
          {detalles ? 'Ocultar detalles' : 'Añadir aviso, etiqueta o sitio'}
        </button>

        {detalles && (
          <>
            <label className="campo">
              <span>Avisarme el</span>
              <input
                type="datetime-local"
                value={aviso}
                onChange={(evento) => setAviso(evento.target.value)}
              />
            </label>
            <label className="campo">
              <span>Etiqueta</span>
              <input
                value={etiqueta}
                placeholder="material, pendiente de pedir…"
                onChange={(evento) => setEtiqueta(evento.target.value)}
              />
            </label>
            <label className="campo">
              <span>Sitio</span>
              <SelectorUbicacion
                valor={ubicacionId}
                onSelecciona={(ubicacion) => setUbicacionId(ubicacion?.id ?? null)}
              />
            </label>
            <p className="suave">
              El sitio es independiente de la jornada: el viernes puedes escribir una nota sobre el
              sitio del miércoles y se archiva donde corresponde.
            </p>
          </>
        )}
      </div>
    </>
  );
}

export function EditarNota({ id }: { id: string }) {
  const { datos, cargando } = useConsulta(() => obtenNota(id), ['notas'], [id]);
  const [borrador, setBorrador] = useState<Nota | null>(null);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

  useEffect(() => {
    if (datos && !borrador) setBorrador(datos);
  }, [datos, borrador]);

  if (cargando) return <div className="contenido" />;
  if (!borrador) {
    return (
      <>
        <Cabecera titulo="Nota" />
        <p className="vacio">Esta nota ya no existe.</p>
      </>
    );
  }

  const nota = borrador;

  function cambia(cambios: Partial<Nota>) {
    setBorrador((actual) => (actual ? { ...actual, ...cambios } : actual));
  }

  return (
    <>
      <Cabecera titulo="Nota" />
      <div className="contenido">
        <label className="campo">
          <span>Texto</span>
          <textarea value={nota.texto} onChange={(e) => cambia({ texto: e.target.value })} />
        </label>

        <label className="campo">
          <span>Avisarme el</span>
          <input
            type="datetime-local"
            value={aInputDateTime(nota.fecha_aviso)}
            onChange={(e) => {
              const instante = desdeInputDateTime(e.target.value);
              // Cambiar la fecha invalida el evento que ya estuviera en el
              // calendario: vuelve a quedar por confirmar.
              cambia({
                fecha_aviso: instante,
                enviado_a_calendario:
                  instante === nota.fecha_aviso ? nota.enviado_a_calendario : false,
              });
            }}
          />
        </label>

        <label className="campo">
          <span>Etiqueta</span>
          <input value={nota.etiqueta} onChange={(e) => cambia({ etiqueta: e.target.value })} />
        </label>

        <label className="campo">
          <span>Sitio</span>
          <SelectorUbicacion
            valor={nota.ubicacion_id}
            onSelecciona={(ubicacion) => cambia({ ubicacion_id: ubicacion?.id ?? null })}
          />
        </label>

        {nota.fecha_aviso && <BloqueCalendario nota={nota} onCambio={cambia} />}

        <div className="fila-botones">
          <button className="boton peligro" onClick={() => setConfirmandoBorrado(true)}>
            Borrar
          </button>
          <button
            className="boton"
            onClick={async () => {
              await guardaNota({
                ...nota,
                estado: nota.estado === 'hecha' ? 'pendiente' : 'hecha',
              });
              atras();
            }}
          >
            {nota.estado === 'hecha' ? 'Reabrir' : 'Marcar hecha'}
          </button>
          <button
            className="boton primario"
            onClick={async () => {
              await guardaNota(nota);
              atras();
            }}
          >
            Guardar
          </button>
        </div>
      </div>

      {confirmandoBorrado && (
        <Confirmacion
          titulo="¿Borrar esta nota?"
          detalle="Si tenía un evento en el calendario, ese evento no se borra solo."
          onCancelar={() => setConfirmandoBorrado(false)}
          onConfirmar={async () => {
            await borraNota(nota.id);
            navega('/notas', true);
          }}
        />
      )}
    </>
  );
}

/**
 * §6 — El usuario abre el `.ics`, el calendario lo reconoce, confirma. Y solo
 * entonces marca la nota. La app no da por hecho que el evento se ha creado:
 * si fallara en silencio, el usuario confiaría en un aviso inexistente.
 */
function BloqueCalendario({
  nota,
  onCambio,
}: {
  nota: Nota;
  onCambio: (cambios: Partial<Nota>) => void;
}) {
  const [generado, setGenerado] = useState(false);

  if (nota.enviado_a_calendario) {
    return (
      <div className="tarjeta">
        <span className="etiqueta-pastilla">En el calendario</span>
        <p className="suave" style={{ marginBottom: 0 }}>
          El calendario avisa; la nota se queda aquí de todas formas.
        </p>
        <button
          className="boton plano"
          onClick={() => onCambio({ enviado_a_calendario: false })}
        >
          No llegó a crearse
        </button>
      </div>
    );
  }

  return (
    <div className="aviso">
      <h3>Aviso sin confirmar</h3>
      <p className="suave">
        Genera el fichero, ábrelo y confirma en el calendario. Después márcalo aquí.
      </p>
      <button
        className="boton ancho"
        onClick={async () => {
          await entregaICS(nota);
          setGenerado(true);
        }}
      >
        Generar el evento (.ics)
      </button>
      {generado && (
        <button
          className="boton ancho"
          style={{ marginTop: 10 }}
          onClick={() => onCambio({ enviado_a_calendario: true })}
        >
          Ya está en el calendario
        </button>
      )}
    </div>
  );
}
