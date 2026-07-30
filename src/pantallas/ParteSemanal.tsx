import { useState } from 'react';
import { Cabecera } from '../ui/componentes';
import { useConsulta } from '../ui/hooks';
import { navega } from '../ui/router';
import { jornadasEntreFechas, leeAjustes, todasLasUbicaciones } from '../db/repos';
import {
  finSemana,
  formateaFechaCorta,
  formateaFechaLarga,
  horaDe,
  hoy,
  inicioSemana,
  sumaDias,
} from '../domain/tiempo';
import { ETIQUETA_MOTIVO } from '../domain/tipos';

/**
 * Genera el parte de trabajo de una semana (lunes a domingo) en `.docx`,
 * reemplazando la plantilla en papel. Ver `informes/parteSemanal.ts` para las
 * decisiones sobre qué se rellena solo y qué se deja en blanco.
 */
export function ParteSemanal() {
  const [fechaRef, setFechaRef] = useState(hoy());
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generado, setGenerado] = useState(false);

  const inicio = inicioSemana(fechaRef);
  const fin = finSemana(fechaRef);

  const { datos } = useConsulta(
    async () => {
      const [jornadas, ubicaciones, ajustes] = await Promise.all([
        jornadasEntreFechas(inicio, fin),
        todasLasUbicaciones(),
        leeAjustes(),
      ]);
      return { jornadas, ubicaciones, ajustes };
    },
    ['jornadas', 'ubicaciones', 'ajustes'],
    [inicio, fin],
  );

  const jornadas = datos?.jornadas ?? [];
  const porCompletar = jornadas.filter(
    (j) => j.estado !== 'abierta' && !(j.ubicacion_id && j.motivo && j.hora_fin),
  );

  async function generar() {
    if (!datos || generando) return;
    setGenerando(true);
    setError(null);
    setGenerado(false);
    try {
      // `docx` pesa varios cientos de KB: se carga solo al generar un parte, no
      // en el arranque de toda la app.
      const { construyeFilas, construyeParteSemanal, entregaParteSemanal } = await import(
        '../informes/parteSemanal'
      );
      const porId = new Map(datos.ubicaciones.map((u) => [u.id, u]));
      const filas = construyeFilas(jornadas, porId);
      const blob = await construyeParteSemanal({ inicio, fin, ajustes: datos.ajustes, filas });
      await entregaParteSemanal(blob, inicio);
      setGenerado(true);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
    } finally {
      setGenerando(false);
    }
  }

  return (
    <>
      <Cabecera titulo="Parte semanal" />
      <div className="contenido">
        <div className="fila-botones" style={{ marginBottom: 12 }}>
          <button className="boton" onClick={() => setFechaRef(sumaDias(inicio, -7))}>
            ‹ Semana anterior
          </button>
          <button className="boton" onClick={() => setFechaRef(sumaDias(inicio, 7))}>
            Semana siguiente ›
          </button>
        </div>

        <div className="tarjeta">
          <strong>
            {formateaFechaLarga(inicio)} — {formateaFechaLarga(fin)}
          </strong>
        </div>

        {!datos?.ajustes.nombre_tecnico && (
          <div className="aviso">
            <h3>Faltan tus datos</h3>
            <p className="suave">
              El parte saldrá con el nombre en blanco. Se rellenan una vez en Ajustes.
            </p>
            <button className="boton plano" onClick={() => navega('/ajustes')}>
              Ir a Ajustes
            </button>
          </div>
        )}

        {porCompletar.length > 0 && (
          <div className="aviso">
            <h3>
              {porCompletar.length}{' '}
              {porCompletar.length === 1 ? 'jornada por completar' : 'jornadas por completar'} esta
              semana
            </h3>
            <p className="suave">
              Sin sitio o sin motivo, la fila del parte saldrá incompleta. Se puede generar igual.
            </p>
            <button className="boton plano" onClick={() => navega('/completar')}>
              Completar antes
            </button>
          </div>
        )}

        <div className="seccion">
          <h2>Jornadas de la semana</h2>
          {jornadas.length === 0 ? (
            <p className="vacio">Ninguna jornada registrada en estos días.</p>
          ) : (
            <ul className="lista">
              {jornadas.map((jornada) => {
                const ubicacion = jornada.ubicacion_id
                  ? datos?.ubicaciones.find((u) => u.id === jornada.ubicacion_id)
                  : undefined;
                return (
                  <li className="tarjeta" key={jornada.id}>
                    <strong>{formateaFechaCorta(jornada.fecha)}</strong> —{' '}
                    {ubicacion?.nombre ?? 'Sin asignar'}
                    <div className="linea-meta">
                      <span>
                        {horaDe(jornada.hora_inicio)}–{horaDe(jornada.hora_fin)}
                      </span>
                      {jornada.motivo && <span>{ETIQUETA_MOTIVO[jornada.motivo]}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button className="boton primario ancho" disabled={generando} onClick={() => void generar()}>
          {generando ? 'Generando…' : 'Generar y descargar (.docx)'}
        </button>
        {generado && <p className="suave">Listo. Revísalo antes de entregarlo.</p>}
        {error && <p className="aviso rojo">{error}</p>}
      </div>
    </>
  );
}
