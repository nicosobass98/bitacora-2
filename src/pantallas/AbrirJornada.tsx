import { useState } from 'react';
import { Cabecera, SelectorUbicacion } from '../ui/componentes';
import { useConsulta, useMinuto } from '../ui/hooks';
import { navega } from '../ui/router';
import { abreJornada, jornadasPorUbicacion, notasPorUbicacion } from '../db/repos';
import {
  aInputDateTime,
  aInstanteISO,
  desdeInputDateTime,
  fechaDe,
  formateaFechaCorta,
  horaDe,
  hoy,
} from '../domain/tiempo';
import { ETIQUETA_MOTIVO, MOTIVOS, type Motivo, type Ubicacion } from '../domain/tipos';

/**
 * §5.2 — Dos toques: sitio y motivo. La hora se captura sola.
 *
 * Nada es obligatorio: si falta la ubicación, la jornada se abre igual como
 * «sin asignar». Nunca se bloquea al usuario en la puerta de un sitio.
 */
export function AbrirJornada() {
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  /** `null` = usar la hora del momento en que se pulse. Ver `SelectorInicio`. */
  const [inicio, setInicio] = useState<string | null>(null);

  async function abrir(motivoElegido: Motivo | null) {
    if (abriendo) return;
    setAbriendo(true);
    await abreJornada({
      ubicacion_id: ubicacion?.id ?? null,
      motivo: motivoElegido,
      hora_inicio: inicio,
    });
    navega('/', true);
  }

  return (
    <>
      <Cabecera titulo="Abrir jornada" />
      <div className="contenido">
        <label className="campo">
          <span>Sitio</span>
          <SelectorUbicacion
            valor={ubicacion?.id ?? null}
            onSelecciona={setUbicacion}
            autoFoco
          />
        </label>

        {ubicacion && <HistoricoUbicacion ubicacion={ubicacion} />}

        <SelectorInicio valor={inicio} onCambia={setInicio} />

        <div className="campo">
          <span>Motivo</span>
          <div className="rejilla-botones">
            {MOTIVOS.map((opcion) => (
              <button
                key={opcion}
                className="boton"
                aria-pressed={motivo === opcion}
                onClick={() => {
                  setMotivo(opcion);
                  void abrir(opcion);
                }}
              >
                {ETIQUETA_MOTIVO[opcion]}
              </button>
            ))}
          </div>
        </div>

        <button className="boton ancho" disabled={abriendo} onClick={() => void abrir(motivo)}>
          Abrir sin motivo
        </button>
        <p className="suave" style={{ marginTop: 12 }}>
          Lo que falte se completa después, en frío. Abrir siempre gana a rellenar.
        </p>
        {inicio !== null && fechaDe(inicio) !== hoy() && (
          <p className="suave">
            Se archivará en el {formateaFechaCorta(fechaDe(inicio))}, no en el día de hoy.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Hora de inicio (§3.1: «capturada automáticamente, editable»).
 *
 * Por defecto no se toca nada: se muestra la hora actual y la jornada se abre
 * con la del momento exacto en que se pulsa el motivo. Eso es deliberado — si
 * se guardara aquí la hora de cuando se pintó la pantalla, dejar el móvil en el
 * bolsillo cinco minutos metería una hora falsa en el parte.
 *
 * Por eso `valor === null` significa «la que sea al pulsar», y solo cuando el
 * usuario ajusta la hora a mano se fija un instante concreto. Ahí es él quien
 * pone el dato, que es justo lo que hace falta para registrar en frío una
 * jornada que empezó antes.
 */
function SelectorInicio({
  valor,
  onCambia,
}: {
  valor: string | null;
  onCambia: (valor: string | null) => void;
}) {
  const tic = useMinuto();
  const [ajustando, setAjustando] = useState(false);
  const instanteActual = aInstanteISO(new Date(tic));
  const mostrado = valor ?? instanteActual;
  const esHoy = fechaDe(mostrado) === hoy();

  if (!ajustando) {
    return (
      <div className="campo">
        <span>Inicio</span>
        <div className="tarjeta">
          <strong>
            {esHoy ? 'Hoy' : formateaFechaCorta(fechaDe(mostrado))} a las {horaDe(mostrado)}
          </strong>
          {valor === null && <div className="suave">Se pone sola al elegir el motivo.</div>}
          <button
            className="boton plano"
            onClick={() => {
              // Se fija el instante al entrar a editar: si se dejara en `null`,
              // el reloj seguiría corriendo y movería el campo mientras se toca.
              if (valor === null) onCambia(instanteActual);
              setAjustando(true);
            }}
          >
            {valor === null ? 'Empezó antes: ajustar' : 'Cambiar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="campo">
      <span>Inicio</span>
      <input
        type="datetime-local"
        autoFocus
        value={aInputDateTime(mostrado)}
        onChange={(evento) => onCambia(desdeInputDateTime(evento.target.value))}
      />
      <div className="fila-botones">
        <button
          className="boton"
          onClick={() => {
            onCambia(null);
            setAjustando(false);
          }}
        >
          Usar la hora actual
        </button>
        <button className="boton" onClick={() => setAjustando(false)}>
          Hecho
        </button>
      </div>
    </div>
  );
}

/**
 * §5.2 — Al abrir, el histórico del sitio: «Última visita: 4 junio, avería,
 * cambiada fuente de alimentación». Es lo que evita repetir el mismo
 * diagnóstico dos veces.
 */
function HistoricoUbicacion({ ubicacion }: { ubicacion: Ubicacion }) {
  const { datos } = useConsulta(
    async () => {
      const [jornadas, notas] = await Promise.all([
        jornadasPorUbicacion(ubicacion.id),
        notasPorUbicacion(ubicacion.id),
      ]);
      return { ultima: jornadas.find((j) => j.estado !== 'abierta'), notas };
    },
    ['jornadas', 'notas'],
    [ubicacion.id],
  );

  if (!datos) return null;
  const { ultima, notas } = datos;
  const pendientes = notas.filter((n) => n.estado === 'pendiente');

  return (
    <div className="tarjeta">
      {ultima ? (
        <>
          <div className="suave">Última visita</div>
          <strong>{formateaFechaCorta(ultima.fecha)}</strong>
          {ultima.motivo && <> — {ETIQUETA_MOTIVO[ultima.motivo].toLowerCase()}</>}
          {ultima.notas && <div>{ultima.notas}</div>}
        </>
      ) : (
        <div className="suave">Primera visita registrada a este sitio.</div>
      )}

      {ubicacion.notas_acceso && (
        <p className="suave" style={{ marginTop: 10 }}>
          Acceso: {ubicacion.notas_acceso}
        </p>
      )}

      {pendientes.length > 0 && (
        <p style={{ marginTop: 10 }}>
          <span className="etiqueta-pastilla aviso">
            {pendientes.length} {pendientes.length === 1 ? 'nota pendiente' : 'notas pendientes'}
          </span>
        </p>
      )}
    </div>
  );
}
