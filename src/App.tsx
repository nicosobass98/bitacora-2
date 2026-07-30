import { useEffect } from 'react';
import { BotonNota, Navegacion } from './ui/componentes';
import { encaja, useRuta } from './ui/router';
import { arrancaSincronizacion } from './sync/sincronizador';
import { Inicio } from './pantallas/Inicio';
import { AbrirJornada } from './pantallas/AbrirJornada';
import { CerrarJornada } from './pantallas/CerrarJornada';
import { EditarJornada } from './pantallas/EditarJornada';
import { Completar, Dia, Historial } from './pantallas/Historial';
import { FichaUbicacion, Ubicaciones } from './pantallas/Ubicaciones';
import { EditarNota, NuevaNota, Notas } from './pantallas/Notas';
import { Ajustes } from './pantallas/Ajustes';
import { ParteSemanal } from './pantallas/ParteSemanal';

/**
 * Tabla de rutas. El orden importa: las rutas literales van antes que las que
 * llevan parámetro.
 */
function resuelve(ruta: string) {
  if (ruta === '/') return { pantalla: <Inicio />, conNota: true };
  if (ruta === '/jornada/abrir') return { pantalla: <AbrirJornada />, conNota: false };
  if (ruta === '/jornada/cerrar') return { pantalla: <CerrarJornada />, conNota: true };
  if (ruta === '/completar') return { pantalla: <Completar />, conNota: true };
  if (ruta === '/historial') return { pantalla: <Historial />, conNota: true };
  if (ruta === '/ubicaciones') return { pantalla: <Ubicaciones />, conNota: true };
  if (ruta === '/notas') return { pantalla: <Notas />, conNota: true };
  if (ruta === '/notas/nueva') return { pantalla: <NuevaNota />, conNota: false };
  if (ruta === '/dia') return { pantalla: <Dia />, conNota: true };
  if (ruta === '/parte') return { pantalla: <ParteSemanal />, conNota: false };
  if (ruta === '/ajustes') return { pantalla: <Ajustes />, conNota: false };

  const jornada = encaja('/jornada/:id', ruta);
  if (jornada?.id) return { pantalla: <EditarJornada id={jornada.id} />, conNota: false };

  const ubicacion = encaja('/ubicacion/:id', ruta);
  if (ubicacion?.id) return { pantalla: <FichaUbicacion id={ubicacion.id} />, conNota: true };

  const nota = encaja('/nota/:id', ruta);
  if (nota?.id) return { pantalla: <EditarNota id={nota.id} />, conNota: false };

  const dia = encaja('/dia/:fecha', ruta);
  if (dia?.fecha) return { pantalla: <Dia fecha={dia.fecha} />, conNota: true };

  return { pantalla: <NoEncontrada ruta={ruta} />, conNota: true };
}

function NoEncontrada({ ruta }: { ruta: string }) {
  return (
    <div className="contenido">
      <p className="vacio">No hay nada en «{ruta}».</p>
      <a className="boton ancho" href="#/">
        Volver al inicio
      </a>
    </div>
  );
}

export function App() {
  const ruta = useRuta();
  const { pantalla, conNota } = resuelve(ruta);

  // El vaciado de la cola corre aparte de la interfaz, desde que arranca la app.
  useEffect(() => {
    arrancaSincronizacion();
  }, []);

  return (
    <div className="app">
      {pantalla}
      {conNota && <BotonNota />}
      <Navegacion ruta={ruta} />
    </div>
  );
}
