/**
 * Esquema de almacenamiento (§5).
 *
 * Trece almacenes. Los movimientos son inmutables una vez escritos; todo lo
 * demas es estado derivado, configuracion o bitacora. Una correccion nunca
 * edita: crea un movimiento nuevo que referencia al anterior, igual que un
 * asiento contable de ajuste.
 */

export const NOMBRE_BD = 'finc';
export const VERSION_ESQUEMA = 2;

/**
 * keyPath null significa que la clave se pasa aparte (almacenes tipo clave-valor).
 * autoIncrement genera la clave. Los indices se declaran con su keyPath.
 */
export const ALMACENES = {
  movements: {
    keyPath: 'id',
    indices: [
      { nombre: 'periodId_ts', keyPath: ['periodId', 'ts'] },
      { nombre: 'periodId_bucket', keyPath: ['periodId', 'bucket'] },
      { nombre: 'bucket_ts', keyPath: ['bucket', 'ts'] },
      { nombre: 'ts', keyPath: 'ts' },
      { nombre: 'corrigeA', keyPath: 'corrigeA' },
      { nombre: 'syncState', keyPath: 'syncState' },
    ],
  },
  periods: {
    keyPath: 'id',
    indices: [
      { nombre: 'status', keyPath: 'status' },
      { nombre: 'cerradoEn', keyPath: 'cerradoEn' },
    ],
  },
  allocations: {
    keyPath: 'id',
    indices: [
      { nombre: 'movementId', keyPath: 'movementId' },
      { nombre: 'periodId_bucket', keyPath: ['periodId', 'bucket'] },
      { nombre: 'periodId', keyPath: 'periodId' },
    ],
  },
  categories: {
    keyPath: 'id',
    indices: [{ nombre: 'defaultBucket', keyPath: 'defaultBucket' }],
  },
  rules: {
    keyPath: 'id',
    indices: [{ nombre: 'prioridad', keyPath: 'prioridad' }],
  },
  funds: { keyPath: 'id', indices: [] },
  fundEntries: {
    keyPath: 'seq',
    autoIncrement: true,
    indices: [
      { nombre: 'fundId_ts', keyPath: ['fundId', 'ts'] },
      { nombre: 'periodId', keyPath: 'periodId' },
    ],
  },
  // Vestigial: el anclaje de saldo se retiro, pero el almacen se mantiene para
  // no perder las anclas que ya hubiera guardadas un usuario existente.
  anchors: {
    keyPath: 'periodId',
    indices: [{ nombre: 'ts', keyPath: 'ts' }],
  },
  sobrantes: {
    keyPath: 'periodId',
    indices: [
      { nombre: 'calculadoEn', keyPath: 'calculadoEn' },
      { nombre: 'destino', keyPath: 'destino' },
    ],
  },
  archives: {
    keyPath: 'periodId',
    indices: [{ nombre: 'formatVersion', keyPath: 'formatVersion' }],
  },
  auditLog: {
    keyPath: 'seq',
    autoIncrement: true,
    indices: [
      { nombre: 'tipo_ts', keyPath: ['tipo', 'ts'] },
      { nombre: 'ts', keyPath: 'ts' },
      { nombre: 'periodId', keyPath: 'periodId' },
    ],
  },
  settings: { keyPath: 'key', indices: [] },
  outbox: {
    keyPath: 'seq',
    autoIncrement: true,
    indices: [{ nombre: 'entidad_entidadId', keyPath: ['entidad', 'entidadId'] }],
  },
  conflicts: {
    keyPath: 'id',
    indices: [
      { nombre: 'entidad_entidadId', keyPath: ['entidad', 'entidadId'] },
      { nombre: 'detectadoEn', keyPath: 'detectadoEn' },
    ],
  },
};

export const NOMBRES = Object.keys(ALMACENES);

/** Campos que viajan en claro por ser claves de indice (§4). El resto va cifrado. */
export const CAMPOS_EN_CLARO = {
  movements: ['id', 'periodId', 'bucket', 'ts', 'tipo', 'syncState', 'corrigeA'],
  allocations: ['id', 'movementId', 'periodId', 'bucket'],
  fundEntries: ['seq', 'fundId', 'periodId', 'ts'],
  auditLog: ['seq', 'tipo', 'ts', 'periodId'],
  anchors: ['periodId', 'ts'],
  archives: ['periodId', 'formatVersion'],
  sobrantes: ['periodId', 'calculadoEn', 'destino'],
};

/** Almacenes cuyo contenido se cifra. periods y settings van enteros en el cuerpo. */
export const CIFRADOS = new Set([
  'movements', 'allocations', 'periods', 'anchors', 'archives',
  'auditLog', 'settings', 'funds', 'fundEntries', 'sobrantes',
]);

/**
 * Identificador ordenable en el tiempo, al estilo ULID.
 * Se genera en la captura, antes de tocar disco, y sirve tambien como clave de
 * deduplicacion entre dispositivos (§5, resolucion de conflictos).
 */
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ultimoMs = 0;
let contador = 0;

export function nuevoId(ahora = Date.now()) {
  if (ahora === ultimoMs) {
    contador += 1;
  } else {
    ultimoMs = ahora;
    contador = 0;
  }

  let tiempo = '';
  let t = ahora;
  for (let i = 0; i < 10; i++) {
    tiempo = ALFABETO[t % 32] + tiempo;
    t = Math.floor(t / 32);
  }

  let azar = '';
  const bytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 10; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // El contador entra en los primeros caracteres para garantizar orden estricto
  // cuando se generan varios ids en el mismo milisegundo.
  bytes[0] = (bytes[0] + contador) % 256;
  for (const b of bytes) azar += ALFABETO[b % 32];

  return tiempo + azar;
}

/** Identificador de dispositivo, estable mientras no se borre el almacen. */
export function nuevoDeviceId() {
  return `dev-${nuevoId().slice(-8)}`;
}

/**
 * Reloj hibrido para la revision de sincronizacion (§5).
 * Formato `${ms}:${contador}:${deviceId}` — ordenable como cadena si se
 * rellenan los campos, que es justo lo que hace padStart.
 */
let hlcMs = 0;
let hlcContador = 0;

export function nuevaRev(deviceId, ahora = Date.now()) {
  if (ahora > hlcMs) {
    hlcMs = ahora;
    hlcContador = 0;
  } else {
    hlcContador += 1;
  }
  return `${String(hlcMs).padStart(15, '0')}:${String(hlcContador).padStart(5, '0')}:${deviceId}`;
}

/** Ajustes por defecto al crear el almacen. */
export function ajustesPorDefecto(zona) {
  return {
    key: 'ajustes',
    zona: zona ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    moneda: 'R$',
    pesos: { ESENCIALES: 5000, INVERSION: 2500, RESERVA: 1500, RECOMPENSAS: 1000 },
    topes: {},
    cascada: { ESENCIALES: 'RESERVA', RECOMPENSAS: 'RESERVA', RESERVA: 'FONDO_AHORRO' },
    politicaCarry: { ESENCIALES: 'EXPIRA', INVERSION: 'CARTERA_INVERSION' },

    // Ingreso mensual normal (§14). Se pregunta una vez, en el alta, y se
    // aplica solo cada dia 1. Sustituye al anclaje manual de saldo.
    ingresoNormal: { montoCents: 0, configurado: false, diaAplicacion: 1, pesos: null },

    destinos: DESTINOS_INICIALES,

    notificaciones: {
      informe: true,
      subfinanciamiento: true,
      proyeccion: true,
      sobrante: true,
      inactividad: false,
      hora: '09:00',
    },
    plantillas: [],
    ultimoDiagnosticoEn: null,
    diagnosticoPospuestoHasta: null,
  };
}

/**
 * Copia literal de DESTINOS_POR_DEFECTO de dominio/destinos.js.
 *
 * Esta duplicado a proposito: esquema.js no debe importar del dominio, porque
 * es la capa de datos y el dominio no conoce el almacen. Si cambian los
 * destinos de arranque, hay que tocar los dos sitios; el test lo comprueba.
 */
const DESTINOS_INICIALES = {
  ESENCIALES: [],
  INVERSION: [
    { id: 'cachinha', nombre: 'Cachinha de Nubank', pideTexto: false },
    { id: 'otro-inversion', nombre: 'Otro tipo de inversión', pideTexto: true, etiquetaTexto: 'Especifica' },
  ],
  RESERVA: [{ id: 'cachinha', nombre: 'Cachinha de Nubank', pideTexto: false }],
  RECOMPENSAS: [
    { id: 'plan-hotel', nombre: 'Plan de hotel', pideTexto: false },
    { id: 'otro-recompensa', nombre: 'Otro', pideTexto: true, etiquetaTexto: 'Especifica' },
  ],
};
