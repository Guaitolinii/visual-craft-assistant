# Gera os ícones do app web (PWA) a partir do icon.png (1024x1024).
# Uso: python scripts/make-web-icons.py   (Pillow). Os PNGs gerados ficam em web/icons/ e são versionados.
from pathlib import Path
from PIL import Image, ImageChops

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "icon.png"
DESTINO = RAIZ / "web" / "icons"
FUNDO = (11, 11, 17)  # #0B0B11, mesmo fundo do ícone original


def sobre_fundo(img, tamanho):
    """Achata a imagem sobre o fundo escuro (sem transparência) no tamanho pedido."""
    base = Image.new("RGB", img.size, FUNDO)
    base.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    return base.resize((tamanho, tamanho), Image.LANCZOS)


def caixa_do_logo(rgb):
    """Retângulo que contém o desenho (tudo que difere do fundo)."""
    dif = ImageChops.difference(rgb, Image.new("RGB", rgb.size, FUNDO)).convert("L").point(lambda v: 255 if v > 24 else 0)
    return dif.getbbox()


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    original = Image.open(ORIGEM).convert("RGBA")
    achatado = sobre_fundo(original, 1024)

    # ícones "normais": o próprio icon.png reduzido
    for nome, t in (("icon-180.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        achatado.resize((t, t), Image.LANCZOS).save(DESTINO / nome, optimize=True)

    # maskable: o logo inteiro cabe dentro de 70% da área central, sobre o fundo escuro
    caixa = caixa_do_logo(achatado)
    logo = achatado.crop(caixa)
    alvo = int(512 * 0.70)
    esc = min(alvo / logo.width, alvo / logo.height)
    logo = logo.resize((max(1, round(logo.width * esc)), max(1, round(logo.height * esc))), Image.LANCZOS)
    tela = Image.new("RGB", (512, 512), FUNDO)
    tela.paste(logo, ((512 - logo.width) // 2, (512 - logo.height) // 2))
    tela.save(DESTINO / "icon-maskable-512.png", optimize=True)

    # favicon: só a TV (o texto não lê em 32 px); recorta a parte de cima do desenho
    x0, y0, x1, y1 = caixa
    glifo = achatado.crop((x0, y0, x1, y0 + int((y1 - y0) * 0.66)))
    lado = max(glifo.width, glifo.height) + 40
    quadro = Image.new("RGB", (lado, lado), FUNDO)
    quadro.paste(glifo, ((lado - glifo.width) // 2, (lado - glifo.height) // 2))
    quadro.resize((32, 32), Image.LANCZOS).save(DESTINO / "favicon-32.png", optimize=True)
    print("icones gerados em", DESTINO)


if __name__ == "__main__":
    main()
