import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { atras, navega } from './router';
import { useConsulta, useEstadoSync } from './hooks';
import { creaUbicacion, ubicacionesPorUsoReciente } from '../db/repos';
import { vaciaCola } from '../sync/sincronizador';
import type { Ubicacion } from '../domain/tipos';

export function Cabecera({
  titulo,
  volver = true,
  accion,
}: {
  titulo: string;
  volver?: boolean;
  accion?: ReactNode;
}) {
  return (
    <header className="cabecera">
      {volver && (
        <button className="volver" onClick={atras} aria-label="Volver">
          ‹
        </button>
      )}
      <h1>{titulo}</h1>
      {accion}
    </header>
  );
}

/**
 * Estado de sincronización, siempre visible (§7): verde al día, ámbar
 * pendiente, rojo con fallo. Nunca en silencio.
 */
export function EstadoSincronizacion() {
  const info = useEstadoSync();

  const { color, texto } = useMemo(() => {
    switch (info.estado) {
      case 'al_dia':
        return { color: 'verde', texto: 'Copia al día' };
      case 'sincronizando':
        return { color: 'ambar', texto: 'Enviando…' };
      case 'pendiente':
        return {
          color: 'ambar',
          texto: `${info.pendientes} sin enviar${info.mensaje ? ` · ${info.mensaje}` : ''}`,
        };
      case 'requiere_sesion':
        return { color: 'ambar', texto: 'Hay que volver a entrar en Google' };
      case 'sin_configurar':
        return { color: 'gris', texto: 'Google sin conectar' };
      case 'fallo':
        return { color: 'rojo', texto: `${info.fallidos} registros con error` };
    }
  }, [info]);

  return (
    <button
      className="estado-sync"
      onClick={() => navega('/ajustes')}
      title={info.mensaje ?? undefined}
    >
      <span className={`punto ${color}`} aria-hidden="true" />
      <span>{texto}</span>
    </button>
  );
}

/** Botón flotante de nota rápida, accesible desde cualquier pantalla (§5.5). */
export function BotonNota() {
  return (
    <button className="fab" onClick={() => navega('/notas/nueva')} aria-label="Nueva nota">
      +
    </button>
  );
}

export function Navegacion({ ruta }: { ruta: string }) {
  const entradas: { href: string; icono: string; texto: string; activa: (r: string) => boolean }[] =
    [
      { href: '/', icono: '⬤', texto: 'Inicio', activa: (r) => r === '/' },
      {
        href: '/historial',
        icono: '☰',
        texto: 'Historial',
        activa: (r) => r.startsWith('/historial') || r.startsWith('/jornada/'),
      },
      {
        href: '/ubicaciones',
        icono: '⌂',
        texto: 'Sitios',
        activa: (r) => r.startsWith('/ubicacion'),
      },
      { href: '/notas', icono: '✎', texto: 'Notas', activa: (r) => r.startsWith('/nota') },
    ];

  return (
    <nav className="navegacion">
      {entradas.map((entrada) => (
        <a
          key={entrada.href}
          href={`#${entrada.href}`}
          className={entrada.activa(ruta) ? 'activo' : ''}
        >
          <span className="icono" aria-hidden="true">
            {entrada.icono}
          </span>
          {entrada.texto}
        </a>
      ))}
    </nav>
  );
}

/** Ninguna acción destructiva sin confirmación (§7). */
export function Confirmacion({
  titulo,
  detalle,
  textoConfirmar = 'Borrar',
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  detalle?: string;
  textoConfirmar?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="velo" role="dialog" aria-modal="true" onClick={onCancelar}>
      <div className="dialogo" onClick={(evento) => evento.stopPropagation()}>
        <h2>{titulo}</h2>
        {detalle && <p className="suave">{detalle}</p>}
        <div className="fila-botones">
          <button className="boton" onClick={onCancelar}>
            Cancelar
          </button>
          <button className="boton peligro" onClick={onConfirmar}>
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Autocompletado de ubicación (§5.2). Ordenado por uso reciente, porque el
 * sitio de hoy suele ser uno de los de la semana pasada. Si no existe, se crea
 * en el momento sin salir de la pantalla.
 */
export function SelectorUbicacion({
  valor,
  onSelecciona,
  autoFoco = false,
}: {
  valor: string | null;
  onSelecciona: (ubicacion: Ubicacion | null) => void;
  autoFoco?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const { datos: ubicaciones } = useConsulta(ubicacionesPorUsoReciente, ['ubicaciones']);

  const seleccionada = ubicaciones?.find((u) => u.id === valor) ?? null;

  useEffect(() => {
    if (autoFoco) entrada.current?.focus();
  }, [autoFoco]);

  const filtradas = useMemo(() => {
    if (!ubicaciones) return [];
    const busqueda = texto.trim().toLowerCase();
    if (!busqueda) return ubicaciones.slice(0, 8);
    return ubicaciones
      .filter(
        (u) =>
          u.nombre.toLowerCase().includes(busqueda) || u.cliente.toLowerCase().includes(busqueda),
      )
      .slice(0, 8);
  }, [ubicaciones, texto]);

  const nombreExacto = filtradas.some(
    (u) => u.nombre.toLowerCase() === texto.trim().toLowerCase(),
  );

  async function crear() {
    const nombre = texto.trim();
    if (!nombre) return;
    const ubicacion = await creaUbicacion({ nombre });
    setTexto('');
    setAbierto(false);
    onSelecciona(ubicacion);
  }

  if (seleccionada && !abierto) {
    return (
      <div className="tarjeta">
        <strong>{seleccionada.nombre}</strong>
        {seleccionada.cliente && <div className="suave">{seleccionada.cliente}</div>}
        <button className="boton plano" onClick={() => setAbierto(true)}>
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={entrada}
        type="text"
        value={texto}
        placeholder="Buscar o crear sitio…"
        onChange={(evento) => setTexto(evento.target.value)}
        onFocus={() => setAbierto(true)}
        autoComplete="off"
      />
      <ul className="sugerencias">
        {filtradas.map((ubicacion) => (
          <li key={ubicacion.id}>
            <button
              onClick={() => {
                setTexto('');
                setAbierto(false);
                onSelecciona(ubicacion);
              }}
            >
              {ubicacion.nombre}
              {ubicacion.cliente && <span className="suave"> · {ubicacion.cliente}</span>}
            </button>
          </li>
        ))}
        {texto.trim() && !nombreExacto && (
          <li>
            <button className="crear" onClick={crear}>
              Crear «{texto.trim()}»
            </button>
          </li>
        )}
        {!texto.trim() && filtradas.length === 0 && (
          <li>
            <button className="crear" disabled>
              Escribe el nombre del sitio para crearlo
            </button>
          </li>
        )}
      </ul>
      {seleccionada && (
        <button className="boton plano" onClick={() => setAbierto(false)}>
          Mantener «{seleccionada.nombre}»
        </button>
      )}
    </div>
  );
}

export function BotonSincronizar() {
  const [enviando, setEnviando] = useState(false);
  return (
    <button
      className="boton"
      disabled={enviando}
      onClick={async () => {
        setEnviando(true);
        try {
          await vaciaCola();
        } finally {
          setEnviando(false);
        }
      }}
    >
      {enviando ? 'Enviando…' : 'Sincronizar ahora'}
    </button>
  );
}
