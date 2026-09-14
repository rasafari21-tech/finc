# finc

PWA offline-first de auditoría financiera personal para iPhone. Cuatro techos
(50 % Esenciales · 25 % Inversión · 15 % Reserva · 10 % Recompensas), reglas de
clasificación que no se pueden desactivar, y cierre automático el día 1.

Implementa `SPEC-AT-001`. **Sin dependencias y sin paso de compilación**: son
módulos ES nativos que el navegador carga tal cual.

---

## Probarlo ahora mismo

**Opción rápida — un solo archivo.** Abre `prueba.html` haciendo doble clic. Es
la app entera más un panel de pruebas (botón ⚗ abajo a la derecha) con reloj
manipulable, sembrado de datos y un botón por escenario: ingresos grandes y
pequeños, destinos, cierre de mes, sobrante e historial. Sin él tendrías que
esperar a que sea 1 de octubre para ver un cierre.

**Opción completa — servida.** Para ver la PWA de verdad, con Service Worker,
IndexedDB y funcionamiento sin red:

```
python -m http.server 8000
```

y abre `http://localhost:8000`. En Chrome, F12 → Toggle device toolbar → iPhone.

| | `prueba.html` (file://) | servida en localhost |
|---|---|---|
| Lógica de negocio | idéntica | idéntica |
| Almacén | memoria + localStorage | IndexedDB |
| Service Worker | no | sí |
| Instalable | no | sí |

El aviso de arriba en `prueba.html` dice en cada momento qué está activo.

---

## Comandos

```
npm test              # 176 pruebas del motor financiero
npm run servir        # python -m http.server 8000
npm run empaquetar    # regenera prueba.html desde el código real
python tools/iconos.py  # regenera los iconos desde iconos/portada.jpg
```

Node **solo** hace falta para los tests. La app no lo usa.

`prueba.html` se **genera**, no se edita: `tools/empaquetar.py` inlinea los
módulos reales. Si tocas el código, vuelve a ejecutar `npm run empaquetar`.

---

## Estructura

```
src/dominio/     JS puro, sin I/O, sin DOM  ← el corazón
  reparto.js       reparto por resto mayor + cascada de techos
  reglas.js        las 18 reglas núcleo
  clasificador.js  evalúa un movimiento y emite el veredicto
  cierre.js        cierre perezoso e idempotente
  carry.js         destino del remanente de cada techo
  diagnostico.js   señales S1/S2/S3 y propuesta de rebalanceo
  destinos.js      a dónde va el dinero de cada techo
  redondeo.js      reparto en cantidades redondas, sin céntimos sueltos
  informales.js    los R$20 de mitad de mes: cómo se reparten
  sobrante.js      lo que queda libre al acabar el mes
src/datos/       IndexedDB, motor en memoria y bóveda de cifrado
src/app/         comandos, reloj inyectable, estado
src/ui/          componentes y hojas
test/            node --test
tools/           empaquetador, generador de iconos, panel de pruebas
```

El dominio no conoce IndexedDB, ni el reloj del sistema, ni el DOM: los recibe
inyectados. Por eso un cierre de doce meses se reproduce en milisegundos.

---

## Instalarlo en el iPhone

Hace falta **HTTPS**. `localhost` es contexto seguro, pero `http://192.168.x.x`
no: sobre LAN en claro iOS no registra Service Worker ni permite WebAuthn, y sin
eso no hay app instalable ni offline.

Dos caminos:

1. **Túnel.** `cloudflared tunnel --url http://localhost:8000` da una URL HTTPS
   temporal. Bien para probar, no para uso diario.
2. **Alojamiento estático.** Sube la carpeta a Netlify, Vercel, Cloudflare Pages
   o GitHub Pages. Todo es estático; no hay servidor que configurar.

Ya en el iPhone: Safari → Compartir → **Añadir a pantalla de inicio**. No es
opcional. Sin instalar no hay notificaciones y Safari puede borrar el almacén
tras siete días sin uso.

### El icono

Sale de `iconos/portada.jpg` y lo genera `tools/iconos.py`.

La portada es **pixel art**, y eso manda sobre todo lo demás: escalarla con un
filtro suave la convierte en una mancha borrosa. Todo se escala con vecino más
cercano, que conserva el borde duro de cada píxel.

Hay un problema previo: la portada llega en JPEG, y el JPEG destroza justo lo
que define al pixel art —los bordes salen con halo y aparecen decenas de
blancos distintos—. Así que el script mide el tamaño real de la celda, encuentra
el desfase de la rejilla, reconstruye el dibujo lógico tomando el color
dominante del centro de cada celda y fusiona los colores casi idénticos. De 980
píxeles emborronados salen 64×64 celdas limpias con doce colores.

El lado del recorte es potencia de dos a propósito: 64 × 3 = 192, × 8 = 512,
× 16 = 1024. Los tamaños que pide el sistema salen por multiplicación exacta,
sin interpolar ni un píxel.

Para cambiar la portada: sustituye `iconos/portada.jpg` y ejecuta el script. Si
la nueva no es pixel art, lo detecta por el número de colores y pasa a recorte
centrado con filtro suave, que es lo correcto para una fotografía.

Dos archivos sirven para comprobarlo sin tocar el teléfono:
`iconos/previsualizacion.png` aplica la máscara real de iOS y
`iconos/pantalla-inicio.png` enseña cómo queda a tamaño de pantalla de inicio.
`iconos/logica.png` es el dibujo reconstruido, por si quieres editarlo a mano.

**Ojo al cambiarlo:** iOS congela el icono al añadir la app a la pantalla de
inicio. Si cambias la portada de una app ya instalada, hay que borrarla del
teléfono y volver a añadirla; no se actualiza sola.

---

## Qué NO está implementado

| Fuera | Motivo |
|---|---|
| Notificaciones push | Necesitan servidor VAPID con dominio y certificado. El `sw.js` ya trae el handler `push`; falta solo quién lo dispare. Ninguna función depende de ellas: el cierre perezoso cubre el caso. |
| OCR del extracto | Ya no aplica: el anclaje manual de saldo se retiró y lo sustituye el ingreso mensual normal. |
| Sincronización multidispositivo | El esquema lleva `rev`, `outbox` y `conflicts` desde el día uno, pero no hay servidor. |

---

## Cómo funciona el dinero

**Ingreso mensual normal.** Se pregunta una sola vez, al abrir la app por
primera vez, y entra solo cada día 1 repartido **50 % Esenciales · 25 %
Inversión · 15 % Reserva · 10 % Recompensas**. Se cambia desde Ajustes y no hay
que teclear nada cada mes.

**Ingresos informales.** Los R$20 que aparecen a mitad de mes. No se quedan
sueltos: entran al reparto igual que todo lo demás.

| Importe | Qué hace |
|---|---|
| Menos de R$50 | Mitad Inversión, mitad Reserva. Sin preguntar. |
| R$50 o más | Pregunta: mitades, entre las cuatro, o lo eliges tú. |

El umbral se cambia en Ajustes. Dos reglas gobiernan el reparto:

- **Cantidades redondas.** Si el importe no es un número entero de reales, no se
  fragmenta: va entero a un solo techo. R$70 → R$35 + R$35; R$3,27 → R$3,27 a
  Reserva, no R$1,63 + R$1,64.
- **Primero los agujeros.** Si un techo está en rojo, el dinero nuevo lo tapa
  antes de repartirse. Entran R$20 con Esenciales pasado de R$30 → los R$20 van
  a Esenciales, no a Reserva.

**Destinos.** Al elegir techo, la app pregunta a dónde va, sin pedir
justificaciones:

| Techo | Qué aparece |
|---|---|
| Esenciales | Categoría y nota libre, como siempre |
| Inversión | Cachinha de Nubank · Otro tipo de inversión (pide especificar) |
| Reserva | Cachinha de Nubank — se registra directo, sin preguntar |
| Recompensa | Plan de hotel · Otro (pide especificar) |

La lista es editable desde Ajustes: se pueden añadir, renombrar y borrar.

**Marca de ritmo.** La línea vertical de cada barra dice por dónde va el mes:
el día 14 de 30 cae al 47 %. Si la barra la pasa, gastas más rápido de lo que
corre el calendario. Sobresale del carril a propósito, para que se lea como la
muesca de una regla y no como parte de la barra. Al tocar un techo, la hoja de
detalle dice lo mismo con números y palabras: «20 % vs 47 %, vas por detrás».

**Fondos.** El Fondo de Ahorro y la Cartera no están en el panel: viven en la
hoja del ◈, junto al sobrante, que es de lo mismo. En el panel solo enseñaban
dos ceros los primeros meses.

**Sobrante mensual.** Al cerrar el mes se calcula lo que quedó libre de
**Esenciales y Recompensas** —Reserva e Inversión ya tienen destino automático,
así que no son dinero libre—. La cifra se congela y se guarda en el historial.
Si después la inviertes, el historial **no cambia**: septiembre sobraron R$60
aunque acabaran en la Cartera. La víspera del cierre la app avisa de cuánto va
a quedar.

---

## Un aviso honesto

**No hay PIN ni cifrado.** La app abre directa, sin pasos intermedios, y los
datos se guardan en claro en el dispositivo. Es una decisión de uso, no un
descuido: quien tenga tu teléfono desbloqueado puede verlos. El código de la
bóveda (PBKDF2 + AES-GCM, Face ID por WebAuthn) sigue en `src/datos/boveda.js`
por si algún día quieres volver a activarlo.

**La caché.** Al no haber compilación no hay hashes en los nombres de archivo.
Si cambias `app.css` o `main.js`, sube el `?v=` de `index.html` **y** el
`VERSION` de `sw.js`, o el navegador seguirá sirviendo la versión vieja.
