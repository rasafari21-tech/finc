"""Genera los iconos de la PWA a partir de la portada.

La portada es pixel art, y eso manda sobre todo lo demas: si se redimensiona
con un filtro suave se convierte en una mancha borrosa. Aqui todo se escala
con vecino mas cercano, que conserva el borde duro de cada pixel.

Hay un problema previo: la portada llega en JPEG, y el JPEG destroza
precisamente lo que define al pixel art. Los bordes salen con halos y aparecen
docenas de blancos distintos (255, 254, 253...). Asi que el script:

  1. Mide el tamaño real de la celda buscando los bordes fuertes.
  2. Encuentra el desfase de la rejilla probando cual deja las celdas mas
     uniformes por dentro.
  3. Reconstruye el dibujo logico tomando el color dominante del centro de
     cada celda, lejos del halo del borde.
  4. Fusiona los colores casi identicos: lo que eran 40 blancos vuelve a ser
     uno solo.
  5. Recorta alrededor del dibujo. Sobra mucho fondo, y un icono con la figura
     diminuta no se lee en la pantalla de inicio.

El lado del recorte se elige potencia de dos para que los tamaños que pide el
sistema salgan por multiplicacion exacta: 64 x 3 = 192, x 8 = 512, x 16 = 1024.

Si algun dia la portada deja de ser pixel art, el script lo detecta por el
numero de colores y pasa a recorte centrado con filtro suave, que es lo
correcto para una fotografia.

Requiere Pillow (solo para desarrollo):  python -m pip install --user Pillow
"""

import os
import sys
from collections import Counter

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Falta Pillow. Instálalo con:  python -m pip install --user Pillow")

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DESTINO = os.path.join(RAIZ, "iconos")
FUENTE = os.path.join(DESTINO, "portada.jpg")

# Lado del recorte logico. Potencia de dos a proposito: ver cabecera.
LADO_LOGICO = 64
# Colores distintos por encima de los cuales dejamos de tratarlo como pixel art.
MAX_COLORES_PIXEL_ART = 40
# Dos colores mas cercanos que esto son el mismo color estropeado por el JPEG.
DISTANCIA_FUSION = 40

TAMANOS = (180, 192, 512, 1024)


# =========================================================================
# Reconstruccion del pixel art
# =========================================================================

def medir_celda(im):
    """Tamaño del pixel logico, por la distancia entre bordes fuertes."""
    px = im.load()
    W, H = im.size
    distancias = []

    for eje in ("x", "y"):
        largo = W if eje == "x" else H
        grad = [0] * largo
        for i in range(1, largo):
            s = 0
            for j in range(0, (H if eje == "x" else W), 4):
                a = px[i, j] if eje == "x" else px[j, i]
                b = px[i - 1, j] if eje == "x" else px[j, i - 1]
                s += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
            grad[i] = s

        umbral = max(grad) * 0.25
        picos = [i for i in range(1, largo - 1)
                 if grad[i] > umbral and grad[i] >= grad[i - 1] and grad[i] >= grad[i + 1]]
        if not picos:
            continue

        # El JPEG ensancha cada borde en varios pixeles: se agrupan.
        grupos, actual = [], [picos[0]]
        for p in picos[1:]:
            if p - actual[-1] <= 3:
                actual.append(p)
            else:
                grupos.append(sum(actual) // len(actual))
                actual = [p]
        grupos.append(sum(actual) // len(actual))
        distancias += [grupos[i + 1] - grupos[i] for i in range(len(grupos) - 1)]

    if not distancias:
        return None
    return Counter(distancias).most_common(1)[0][0]


def desfase_rejilla(im, celda):
    """Desfase que deja las celdas mas uniformes por dentro."""
    px = im.load()
    W, H = im.size

    def dispersion(offset):
        total = n = 0
        for cy in range(offset, H - celda, celda):
            for cx in range(offset, W - celda, celda):
                a = px[cx + 2, cy + 2]
                b = px[cx + celda - 3, cy + celda - 3]
                total += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
                n += 1
        return total / max(1, n)

    return min(range(celda), key=dispersion)


def reconstruir(im, celda, offset):
    """Dibujo logico: un pixel por celda, con el color dominante de su centro."""
    px = im.load()
    W, H = im.size
    cols = (W - offset) // celda
    filas = (H - offset) // celda
    margen = max(2, celda // 3)

    logica = Image.new("RGB", (cols, filas))
    lp = logica.load()
    for j in range(filas):
        for i in range(cols):
            cx, cy = offset + i * celda, offset + j * celda
            muestras = [px[x, y]
                        for y in range(cy + margen, cy + celda - margen)
                        for x in range(cx + margen, cx + celda - margen)]
            lp[i, j] = Counter(muestras).most_common(1)[0][0]
    return logica


def fusionar_paleta(logica):
    """Devuelve el dibujo con los colores casi iguales unificados."""
    lp = logica.load()
    W, H = logica.size
    cuenta = Counter(lp[i, j] for j in range(H) for i in range(W))

    paleta = []
    for c, _ in cuenta.most_common():
        if any(sum(abs(c[k] - p[k]) for k in range(3)) < DISTANCIA_FUSION for p in paleta):
            continue
        paleta.append(c)

    for j in range(H):
        for i in range(W):
            c = lp[i, j]
            lp[i, j] = min(paleta, key=lambda p: sum(abs(c[k] - p[k]) for k in range(3)))

    return logica, paleta


def recortar_a_la_figura(logica, fondo, lado):
    """Recorta un cuadrado centrado en la figura, rellenando de fondo si hace falta."""
    lp = logica.load()
    W, H = logica.size
    puntos = [(i, j) for j in range(H) for i in range(W) if lp[i, j] != fondo]
    if not puntos:
        return logica.resize((lado, lado), Image.NEAREST)

    xs = [p[0] for p in puntos]
    ys = [p[1] for p in puntos]
    cx = (min(xs) + max(xs)) // 2
    cy = (min(ys) + max(ys)) // 2

    izq = cx - lado // 2
    arriba = cy - lado // 2

    lienzo = Image.new("RGB", (lado, lado), fondo)
    x0, y0 = max(0, izq), max(0, arriba)
    x1, y1 = min(W, izq + lado), min(H, arriba + lado)
    lienzo.paste(logica.crop((x0, y0, x1, y1)), (x0 - izq, y0 - arriba))
    return lienzo


def maestro_pixel_art(im):
    celda = medir_celda(im)
    if not celda or celda < 3:
        return None, None

    offset = desfase_rejilla(im, celda)
    logica = reconstruir(im, celda, offset)
    logica, paleta = fusionar_paleta(logica)
    if len(paleta) > MAX_COLORES_PIXEL_ART:
        return None, None

    fondo = Counter(logica.load()[i, j]
                    for j in range(logica.height)
                    for i in range(logica.width)).most_common(1)[0][0]

    print(f"  pixel art: celda {celda} px, desfase {offset}, "
          f"{logica.width}x{logica.height} celdas, {len(paleta)} colores")
    return recortar_a_la_figura(logica, fondo, LADO_LOGICO), fondo


def maestro_foto(im):
    """Camino alternativo: recorte cuadrado centrado, para una portada normal."""
    lado = min(im.size)
    izq = (im.width - lado) // 2
    arriba = (im.height - lado) // 2
    print(f"  foto: recorte centrado de {lado}x{lado}")
    return im.crop((izq, arriba, izq + lado, arriba + lado)), (243, 242, 240)


# =========================================================================
# Salidas
# =========================================================================

def escalar(maestro, lado, pixel_art):
    filtro = Image.NEAREST if pixel_art else Image.LANCZOS
    return maestro.resize((lado, lado), filtro)


def version_maskable(maestro, fondo, pixel_art, lado=512):
    """Android recorta en circulo: la figura va dentro del 80 % central."""
    margen = int(lado * 0.10)
    interior = lado - 2 * margen
    # Se ajusta el interior a un multiplo del lado logico para no romper la
    # rejilla: si no, los pixeles salen de anchos distintos.
    if pixel_art:
        factor = max(1, interior // maestro.width)
        interior = factor * maestro.width
        margen = (lado - interior) // 2

    lienzo = Image.new("RGB", (lado, lado), fondo)
    lienzo.paste(escalar(maestro, interior, pixel_art), (margen, margen))
    return lienzo


def enmascarar(maestro, lado, pixel_art):
    """Mascara redondeada de iOS: radio del 22,37 % del lado."""
    icono = escalar(maestro, lado, pixel_art).convert("RGBA")
    mascara = Image.new("L", (lado, lado), 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        (0, 0, lado - 1, lado - 1), radius=int(lado * 0.2237), fill=255
    )
    salida = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    salida.paste(icono, (0, 0), mascara)
    return salida


def maqueta_pantalla_inicio(maestro, pixel_art, nombre="finc"):
    """Como queda en la pantalla de inicio, a tres tamaños reales."""
    lienzo = Image.new("RGB", (640, 300), (26, 28, 36))
    dibujo = ImageDraw.Draw(lienzo)
    base, x = 230, 50
    for lado, etiqueta in ((180, "180 px"), (120, "120 px"), (60, "60 px, tamano real")):
        icono = enmascarar(maestro, lado, pixel_art)
        lienzo.paste(icono, (x, base - lado), icono)
        dibujo.text((x, base + 10), nombre, fill=(236, 238, 245))
        dibujo.text((x, base + 26), etiqueta, fill=(120, 128, 150))
        x += lado + 55
    return lienzo


def main():
    if not os.path.exists(FUENTE):
        sys.exit(f"No encuentro la portada en {FUENTE}")

    im = Image.open(FUENTE).convert("RGB")
    print(f"  portada: {im.width}x{im.height}")

    maestro, fondo = maestro_pixel_art(im)
    pixel_art = maestro is not None
    if not pixel_art:
        maestro, fondo = maestro_foto(im)

    os.makedirs(DESTINO, exist_ok=True)
    maestro.save(os.path.join(DESTINO, "logica.png"))
    print(f"  iconos/logica.png  ({maestro.width}x{maestro.height}, el original limpio)")

    for lado in TAMANOS:
        exacto = pixel_art and lado % maestro.width == 0
        escalar(maestro, lado, pixel_art).save(
            os.path.join(DESTINO, f"icono-{lado}.png"), optimize=True)
        print(f"  iconos/icono-{lado}.png{'  (x' + str(lado // maestro.width) + ' exacto)' if exacto else ''}")

    version_maskable(maestro, fondo, pixel_art).save(
        os.path.join(DESTINO, "icono-maskable-512.png"), optimize=True)
    print("  iconos/icono-maskable-512.png")

    enmascarar(maestro, 240, pixel_art).save(os.path.join(DESTINO, "previsualizacion.png"))
    print("  iconos/previsualizacion.png  (con la máscara de iOS aplicada)")

    maqueta_pantalla_inicio(maestro, pixel_art).save(
        os.path.join(DESTINO, "pantalla-inicio.png"))
    print("  iconos/pantalla-inicio.png  (cómo queda en el móvil)")


if __name__ == "__main__":
    main()
