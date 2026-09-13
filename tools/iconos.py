"""Genera los iconos de la PWA a partir de la foto de portada.

El problema: la foto es vertical (821x1743) y un icono de movil es cuadrado.
Recortar sin mas deja fuera lo unico que se reconoce a 60 px, que es el cono.

Lo que hace este script:

  1. Toma la franja superior —cono, cabeza y hombros—, que es la parte que
     sigue siendo legible cuando el icono mide seis milimetros.
  2. Extiende el lienzo por arriba y por la derecha espejando la pared, para
     que la punta del cono no quede pegada a la esquina. iOS recorta las
     esquinas con una mascara redondeada y ahi se comeria la punta.
  3. Saca las medidas que piden iOS y Android, mas una version «maskable»
     con el cono dentro de la zona segura circular.
  4. Deja una previsualizacion con la mascara de iOS aplicada, para poder
     comprobar el encuadre sin instalar nada en el telefono.

Requiere Pillow (solo para desarrollo):  python -m pip install --user Pillow
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.exit("Falta Pillow. Instálalo con:  python -m pip install --user Pillow")

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DESTINO = os.path.join(RAIZ, "iconos")
FUENTE = os.path.join(DESTINO, "portada.jpg")

# --- Encuadre -------------------------------------------------------------
# Margen que se añade espejando la pared, en pixeles de la foto original.
MARGEN_ARRIBA = 60
MARGEN_DERECHA = 80
# Hasta donde baja el recorte. Por debajo empieza el pantalon, que a tamaño
# icono solo aporta una mancha verde sin forma.
ALTO_UTIL = 841

# La foto ya trae su propio fondo, asi que el relleno del «maskable» usa el
# blanco de la pared en vez de un color inventado.
COLOR_PARED = (243, 242, 240)


# Pixeles del borde que se promedian para prolongar cada fila.
MUESTRA_BORDE = 10


def espejar_margen(im, arriba, derecha):
    """Extiende el lienzo con mas pared.

    Dos tecnicas distintas, porque los dos bordes no son iguales:

    Arriba se espeja el bloque entero. Las primeras filas son pared limpia en
    todo el ancho —el cono empieza en y=78—, asi que el reflejo conserva la
    textura del ladrillo sin traer nada mas.

    A la derecha NO se puede espejar ni teselar. El primer intento teselaba una
    franja «de pared» y salieron rayas naranjas repetidas: el JPEG deja un halo
    calido alrededor del cono que pasa cualquier umbral de brillo. Aqui cada
    fila se prolonga con el promedio de sus ultimos pixeles, de modo que las
    juntas horizontales del ladrillo continuan solas y el halo, si lo hay, se
    convierte en un degradado suave en vez de un patron repetido.
    """
    ancho, alto = im.size

    alto_total = alto + arriba
    vertical = Image.new("RGB", (ancho, alto_total))
    vertical.paste(im, (0, arriba))
    if arriba:
        franja = im.crop((0, 0, ancho, arriba)).transpose(Image.FLIP_TOP_BOTTOM)
        vertical.paste(franja, (0, 0))

    if not derecha:
        return vertical

    lienzo = Image.new("RGB", (ancho + derecha, alto_total))
    lienzo.paste(vertical, (0, 0))

    origen = vertical.load()
    dibujo = ImageDraw.Draw(lienzo)
    for y in range(alto_total):
        r = g = b = 0
        for x in range(ancho - MUESTRA_BORDE, ancho):
            pr, pg, pb = origen[x, y]
            r += pr
            g += pg
            b += pb
        n = MUESTRA_BORDE
        dibujo.line(
            [(ancho, y), (ancho + derecha, y)],
            fill=(r // n, g // n, b // n),
        )

    # Un desenfoque leve solo en el margen suaviza el salto entre foto y relleno.
    margen = lienzo.crop((ancho - 4, 0, ancho + derecha, alto_total))
    lienzo.paste(margen.filter(ImageFilter.GaussianBlur(2.5)), (ancho - 4, 0))

    return lienzo


def componer_cuadrado():
    """Devuelve el cuadrado maestro, a la maxima resolucion posible."""
    im = Image.open(FUENTE).convert("RGB")
    recorte = im.crop((0, 0, im.width, min(ALTO_UTIL, im.height)))
    extendido = espejar_margen(recorte, MARGEN_ARRIBA, MARGEN_DERECHA)

    lado = extendido.width
    if extendido.height < lado:
        # Falta alto: se completa espejando tambien por abajo.
        falta = lado - extendido.height
        franja = extendido.crop((0, extendido.height - falta, lado, extendido.height))
        completo = Image.new("RGB", (lado, lado))
        completo.paste(extendido, (0, 0))
        completo.paste(franja.transpose(Image.FLIP_TOP_BOTTOM), (0, extendido.height))
        extendido = completo

    return extendido.crop((0, 0, lado, lado))


def version_maskable(maestro, lado=512):
    """Android recorta en circulo: el cono tiene que caber en el 80 % central."""
    margen = int(lado * 0.12)
    interior = lado - 2 * margen
    lienzo = Image.new("RGB", (lado, lado), COLOR_PARED)
    lienzo.paste(maestro.resize((interior, interior), Image.LANCZOS), (margen, margen))
    return lienzo


def enmascarar(maestro, lado):
    """Aplica la mascara redondeada de iOS. El radio real de iOS es el 22,37 %
    del lado; con eso se ve exactamente que se come la esquina."""
    icono = maestro.resize((lado, lado), Image.LANCZOS).convert("RGBA")
    mascara = Image.new("L", (lado, lado), 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        (0, 0, lado - 1, lado - 1), radius=int(lado * 0.2237), fill=255
    )
    salida = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    salida.paste(icono, (0, 0), mascara)
    return salida


def maqueta_pantalla_inicio(maestro, nombre="finc"):
    """Simula como queda en la pantalla de inicio: tres tamaños reales sobre un
    fondo oscuro, con el nombre debajo. Sirve para comprobar el encuadre sin
    tener que instalar la app en el telefono."""
    fondo = (26, 28, 36)
    ancho, alto = 640, 300
    lienzo = Image.new("RGB", (ancho, alto), fondo)
    dibujo = ImageDraw.Draw(lienzo)

    tamanos = [(180, "180 px"), (120, "120 px"), (60, "60 px, tamano real")]
    # Base comun, como en una fila de la pantalla de inicio: los iconos se
    # apoyan en la misma linea y las etiquetas quedan alineadas debajo.
    base = 230
    x = 50
    for lado, etiqueta in tamanos:
        y = base - lado
        icono = enmascarar(maestro, lado)
        lienzo.paste(icono, (x, y), icono)
        dibujo.text((x, base + 10), nombre, fill=(236, 238, 245))
        dibujo.text((x, base + 26), etiqueta, fill=(120, 128, 150))
        x += lado + 55

    return lienzo


def main():
    if not os.path.exists(FUENTE):
        sys.exit(f"No encuentro la portada en {FUENTE}")

    os.makedirs(DESTINO, exist_ok=True)
    maestro = componer_cuadrado()
    print(f"  cuadrado maestro: {maestro.width}x{maestro.height}")

    for lado in (180, 192, 512, 1024):
        ruta = os.path.join(DESTINO, f"icono-{lado}.png")
        maestro.resize((lado, lado), Image.LANCZOS).save(ruta, optimize=True)
        print(f"  iconos/icono-{lado}.png")

    ruta = os.path.join(DESTINO, "icono-maskable-512.png")
    version_maskable(maestro).save(ruta, optimize=True)
    print("  iconos/icono-maskable-512.png")

    ruta = os.path.join(DESTINO, "previsualizacion.png")
    enmascarar(maestro, 240).save(ruta)
    print("  iconos/previsualizacion.png  (con la máscara de iOS aplicada)")

    ruta = os.path.join(DESTINO, "pantalla-inicio.png")
    maqueta_pantalla_inicio(maestro).save(ruta)
    print("  iconos/pantalla-inicio.png  (cómo queda en el móvil)")


if __name__ == "__main__":
    main()
