import { useCallback, useEffect, useRef, useState } from 'react';
import { suscribe, type TemaCambio } from '../db/bus';
import { observaSync, type InfoSync } from '../sync/sincronizador';

/**
 * Consulta a IndexedDB que se rehace cuando cambia algo de las colecciones
 * indicadas. No hay caché intermedia: la pantalla lee siempre de la fuente de
 * verdad.
 */
export function useConsulta<T>(
  consulta: () => Promise<T>,
  temas: TemaCambio[],
  dependencias: unknown[] = [],
): { datos: T | undefined; cargando: boolean; recarga: () => void } {
  const [datos, setDatos] = useState<T | undefined>(undefined);
  const [cargando, setCargando] = useState(true);
  const consultaRef = useRef(consulta);
  consultaRef.current = consulta;

  const [tic, setTic] = useState(0);
  const recarga = useCallback(() => setTic((n) => n + 1), []);

  const clave = JSON.stringify(dependencias);
  const temasClave = temas.join(',');

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    void consultaRef
      .current()
      .then((resultado) => {
        if (vigente) {
          setDatos(resultado);
          setCargando(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Consulta fallida', error);
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [clave, tic, temasClave]);

  useEffect(() => {
    const interesan = new Set(temasClave.split(','));
    return suscribe((tema) => {
      if (interesan.has(tema)) recarga();
    });
  }, [temasClave, recarga]);

  return { datos, cargando, recarga };
}

export function useEstadoSync(): InfoSync {
  const [info, setInfo] = useState<InfoSync>(() => ({
    estado: 'al_dia',
    pendientes: 0,
    fallidos: 0,
    mensaje: null,
    ultimo_exito: null,
  }));
  useEffect(() => observaSync(setInfo), []);
  return info;
}

/** Reloj de baja frecuencia, para el contador de la jornada abierta. */
export function useMinuto(): number {
  const [tic, setTic] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTic(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return tic;
}
