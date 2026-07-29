import { useState } from 'react';
import { Cabecera, SelectorUbicacion } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { navega } from '../ui/router';
import { abreJornada, jornadasPorUbicacion, notasPorUbicacion } from '../db/repos';
import { formateaFechaCorta } from '../domain/tiempo';
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

  async function abrir(motivoElegido: Motivo | null) {
    if (abriendo) return;
    setAbriendo(true);
    await abreJornada({ ubicacion_id: ubicacion?.id ?? null, motivo: motivoElegido });
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
      </div>
    </>
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
