import { useEffect, useState } from 'react';
import { Cabecera } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { navega } from '../ui/router';
import { cierraJornada, jornadaAbierta, leeAjustes, obtenUbicacion } from '../db/repos';
import {
  aInputDateTime,
  desdeInputDateTime,
  duracionMinutos,
  formateaDuracion,
  formateaFechaCorta,
  horaDe,
  ahora,
} from '../domain/tiempo';

/**
 * §5.3 — Confirmar hora, notas opcionales, cerrar.
 *
 * Cerrar deprisa es un caso previsto, no un error: la jornada queda en
 * `incompleta` y aparece en el contador de por completar.
 */
export function CerrarJornada() {
  const { datos, cargando } = useConsulta(
    async () => {
      const abierta = await jornadaAbierta();
      const ubicacion = abierta?.ubicacion_id ? await obtenUbicacion(abierta.ubicacion_id) : null;
      const ajustes = await leeAjustes();
      return { abierta, ubicacion, ajustes };
    },
    ['jornadas', 'ajustes'],
  );

  const [horaFin, setHoraFin] = useState('');
  const [notas, setNotas] = useState('');
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    if (datos?.abierta && !horaFin) {
      setHoraFin(aInputDateTime(ahora()));
      setNotas(datos.abierta.notas);
    }
  }, [datos?.abierta, horaFin]);

  if (cargando) return <div className="contenido" />;

  if (!datos?.abierta) {
    return (
      <>
        <Cabecera titulo="Cerrar jornada" />
        <div className="contenido">
          <p className="vacio">No hay ninguna jornada abierta.</p>
          <button className="boton ancho" onClick={() => navega('/', true)}>
            Volver al inicio
          </button>
        </div>
      </>
    );
  }

  const { abierta, ubicacion, ajustes } = datos;
  const finISO = desdeInputDateTime(horaFin);
  const minutos = duracionMinutos(abierta.hora_inicio, finISO);
  const finAntesDeInicio = minutos !== null && minutos < 0;
  // Una jornada registrada en frío arrastra su hora de inicio, pero el fin se
  // propone con la de ahora. Sin este aviso, cerrarla de un toque metería una
  // duración disparatada en el parte.
  const duracionSospechosa =
    minutos !== null && minutos > ajustes.horas_aviso_jornada_abierta * 60;

  async function cerrar() {
    if (cerrando || finAntesDeInicio || !finISO) return;
    setCerrando(true);
    await cierraJornada(abierta.id, { hora_fin: finISO, notas });
    navega('/', true);
  }

  return (
    <>
      <Cabecera titulo="Cerrar jornada" />
      <div className="contenido">
        <div className="tarjeta">
          <strong>{ubicacion?.nombre ?? 'Sin asignar'}</strong>
          <div className="linea-meta">
            <span>Inicio {horaDe(abierta.hora_inicio)}</span>
            <span>·</span>
            <span>{formateaDuracion(minutos)}</span>
          </div>
        </div>

        <label className="campo">
          <span>Hora de fin</span>
          <input
            type="datetime-local"
            value={horaFin}
            onChange={(evento) => setHoraFin(evento.target.value)}
          />
        </label>
        {finAntesDeInicio && (
          <p className="aviso rojo">La hora de fin es anterior a la de inicio.</p>
        )}

        {!finAntesDeInicio && duracionSospechosa && (
          <div className="aviso">
            <h3>Saldría una jornada de {formateaDuracion(minutos)}</h3>
            <p className="suave">
              Empezó el {formateaFechaCorta(abierta.fecha)} a las {horaDe(abierta.hora_inicio)}.
              Si es una jornada que registraste en frío, corrige la hora de fin antes de cerrar.
            </p>
          </div>
        )}

        <label className="campo">
          <span>Notas</span>
          <textarea
            value={notas}
            placeholder="Qué se ha hecho, qué queda pendiente…"
            onChange={(evento) => setNotas(evento.target.value)}
          />
        </label>

        <button
          className="boton primario ancho"
          disabled={cerrando || finAntesDeInicio}
          onClick={() => void cerrar()}
        >
          Cerrar jornada
        </button>

        {!abierta.ubicacion_id && (
          <p className="suave" style={{ marginTop: 12 }}>
            Sin sitio asignado: al cerrarla quedará como incompleta y aparecerá en «por completar».
          </p>
        )}
      </div>
    </>
  );
}
