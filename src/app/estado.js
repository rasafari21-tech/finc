/**
 * Store reactivo minimo. Cuarenta lineas en lugar de un framework.
 *
 * Suscripcion, actualizacion parcial y notificacion. No hay estado derivado
 * aqui: los techos y totales ya vienen calculados del dominio.
 */

export function crearEstado(inicial = {}) {
  let valor = { ...inicial };
  const oyentes = new Set();
  let pendiente = false;

  function notificar() {
    if (pendiente) return;
    pendiente = true;
    // Agrupa varias actualizaciones en un unico repintado.
    queueMicrotask(() => {
      pendiente = false;
      for (const fn of oyentes) fn(valor);
    });
  }

  return {
    get() {
      return valor;
    },

    set(parcial) {
      const siguiente = typeof parcial === 'function' ? parcial(valor) : parcial;
      valor = { ...valor, ...siguiente };
      notificar();
      return valor;
    },

    /** Reemplaza el estado completo, sin fusionar. */
    reemplazar(nuevo) {
      valor = nuevo;
      notificar();
      return valor;
    },

    suscribir(fn) {
      oyentes.add(fn);
      fn(valor);
      return () => oyentes.delete(fn);
    },

    /** Fuerza un repintado sincrono, sin esperar al microtask. */
    ahora() {
      pendiente = false;
      for (const fn of oyentes) fn(valor);
    },
  };
}

/** Estado inicial de la captura rapida. */
export function capturaVacia() {
  return {
    modo: 'gasto', // gasto | ingreso
    digitos: '',
    bucket: null,
    // Techos marcados en modo ingreso. Inversion y Reserva de salida.
    bucketsIngreso: ['INVERSION', 'RESERVA'],
    categoryId: null,
    nota: '',
    tags: [],
    razonReserva: null,
    comercio: null,
    comercioTipo: null,
    usoProfesional: false,
    certificable: false,
    relacionadaConIngreso: false,
    grupoLiquidacion: null,
    totalPactadoCents: null,
  };
}
