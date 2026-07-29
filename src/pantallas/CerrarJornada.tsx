import { useEffect, useState } from 'react';
import { Cabecera } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { navega } from '../ui/router';
import { cierraJornada, jornadaAbierta, obtenUbicacion } from '../db/repos';
import {
  aInputDateTime,
  desdeInputDateTime,
  duracionMinutos,
  formateaDuracion,
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
      return { abierta, ubicacion };
    },
    ['jornadas'],
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

  const { abierta, ubicacion } = datos;
  const finISO = desdeInputDateTime(horaFin);
  const minutos = duracionMinutos(abierta.hora_inicio, finISO);
  const finAntesDeInicio = minutos !== null && minutos < 0;

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
