import { useEffect, useState } from 'react';

/**
 * Router de hash, sin dependencias.
 *
 * Hash y no History API porque la app se sirve desde una ruta relativa y los
 * atajos del manifiesto (§8.2) apuntan a `#/jornada/abrir` y `#/notas/nueva`.
 */

export function rutaActual(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash === '' ? '/' : hash;
}

export function useRuta(): string {
  const [ruta, setRuta] = useState(rutaActual);

  useEffect(() => {
    const alCambiar = () => setRuta(rutaActual());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  return ruta;
}

export function navega(ruta: string, reemplazar = false): void {
  const destino = `#${ruta}`;
  if (reemplazar) window.location.replace(destino);
  else window.location.hash = destino;
}

export function atras(): void {
  if (window.history.length > 1) window.history.back();
  else navega('/');
}

/**
 * Compara una ruta con un patrón con segmentos `:nombre`.
 * Devuelve los parámetros, o `null` si no encaja.
 */
export function encaja(patron: string, ruta: string): Record<string, string> | null {
  const partesPatron = patron.split('/').filter(Boolean);
  const partesRuta = ruta.split('/').filter(Boolean);
  if (partesPatron.length !== partesRuta.length) return null;

  const parametros: Record<string, string> = {};
  for (let i = 0; i < partesPatron.length; i++) {
    const esperado = partesPatron[i]!;
    const recibido = partesRuta[i]!;
    if (esperado.startsWith(':')) parametros[esperado.slice(1)] = decodeURIComponent(recibido);
    else if (esperado !== recibido) return null;
  }
  return parametros;
}
