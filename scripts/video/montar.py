#!/usr/bin/env python3
"""Monta o vídeo comercial a partir das cenas gravadas por gravar.mjs.

Uso: python3 scripts/video/montar.py <pasta_cenas> <saida.mp4>
Requer Pillow, ffmpeg e a fonte Inter (/usr/share/fonts/opentype/inter).
"""
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

CENAS = os.path.abspath(sys.argv[1])
SAIDA = os.path.abspath(sys.argv[2])
TMP = os.path.join(os.path.dirname(SAIDA), 'montagem')
os.makedirs(TMP, exist_ok=True)
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOGO = os.path.join(RAIZ, 'apps/web/src/assets/logo.png')
W, H, FPS, XF = 1920, 1080, 30, 0.5
LARANJA = (234, 88, 12)
BRANCO = (245, 245, 247)
CINZA = (168, 168, 178)
FONTES = '/usr/share/fonts/opentype/inter'


def fonte(peso, tam):
    return ImageFont.truetype(os.path.join(FONTES, f'Inter-{peso}.otf'), tam)


def fundo():
    """Grafite com um brilho laranja suave."""
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        c = tuple(int(a + (b - a) * t) for a, b in zip((15, 15, 17), (28, 28, 32)))
        d.line([(0, y), (W, y)], fill=c)
    glow = Image.new('RGB', (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W - 900, -500, W + 500, 600], fill=(120, 40, 5))
    ImageDraw.Draw(glow).ellipse([-600, H - 300, 500, H + 500], fill=(60, 22, 4))
    glow = glow.filter(ImageFilter.GaussianBlur(260))
    return ImageChops.add(img, glow)


BG = fundo()


def texto(d, xy, s, f, cor, espaco=0):
    if espaco:
        x, y = xy
        for ch in s:
            d.text((x, y), ch, font=f, fill=cor)
            x += d.textlength(ch, font=f) + espaco
    else:
        d.text(xy, s, font=f, fill=cor)


def camada_topo(buraco, raio, moldura):
    """Fundo com um 'buraco' arredondado onde o vídeo aparece, mais sombra e moldura."""
    x0, y0, x1, y1 = buraco
    sombra = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sombra).rounded_rectangle([x0 - 10, y0 + 6, x1 + 10, y1 + 30], raio + 10, fill=170)
    sombra = sombra.filter(ImageFilter.GaussianBlur(28))
    img = BG.copy().convert('RGBA')
    preto = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    img = Image.composite(preto, img, sombra)
    d = ImageDraw.Draw(img)
    moldura(d)
    furo = Image.new('L', (W, H), 255)
    ImageDraw.Draw(furo).rounded_rectangle(buraco, raio, fill=0)
    img.putalpha(furo)
    return img


# ---------- layouts ----------
DESK_ESC = 0.87
DW, DH = int(1600 * DESK_ESC) // 2 * 2, int(900 * DESK_ESC) // 2 * 2
DX, DY = (W - DW) // 2, 256
PX, PY = 1210, (H - 844) // 2


def topo_desk(kicker, titulo, sub):
    def moldura(d):
        # barra do navegador
        d.rounded_rectangle([DX, DY - 40, DX + DW, DY + 16], 14, fill=(38, 38, 44))
        for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
            d.ellipse([DX + 18 + i * 22, DY - 26, DX + 30 + i * 22, DY - 14], fill=c)
        d.rounded_rectangle([DX + 110, DY - 31, DX + 560, DY - 9], 8, fill=(26, 26, 30))
        d.text((DX + 124, DY - 29), 'bardoguto · sistema da loja', font=fonte('Medium', 15), fill=CINZA)
        texto(d, (DX, 62), kicker.upper(), fonte('Bold', 22), LARANJA, 3)
        d.text((DX, 96), titulo, font=fonte('Bold', 54), fill=BRANCO)
        d.text((DX, 166), sub, font=fonte('Regular', 26), fill=CINZA)
    return camada_topo([DX, DY, DX + DW, DY + DH], 6, moldura)


def topo_fone(kicker, titulo, linhas):
    def moldura(d):
        b = 14
        d.rounded_rectangle([PX - b, PY - b, PX + 390 + b, PY + 844 + b], 58, fill=(10, 10, 12), outline=(70, 70, 78), width=3)
        tx, ty = 200, 300
        texto(d, (tx, ty), kicker.upper(), fonte('Bold', 24), LARANJA, 3)
        y = ty + 44
        for t in titulo.split('\n'):
            d.text((tx, y), t, font=fonte('Bold', 64), fill=BRANCO)
            y += 78
        y += 26
        for ln in linhas:
            d.ellipse([tx, y + 12, tx + 10, y + 22], fill=LARANJA)
            d.text((tx + 28, y), ln, font=fonte('Regular', 30), fill=(210, 210, 216))
            y += 52
    return camada_topo([PX, PY, PX + 390, PY + 844], 46, moldura)


def quadro_fixo(desenho):
    img = BG.copy()
    desenho(ImageDraw.Draw(img), img)
    return img


def centro(d, y, s, f, cor):
    d.text(((W - d.textlength(s, font=f)) / 2, y), s, font=f, fill=cor)


AUTOR = 'Gustavo Alves'
CURSO = 'Estudante de Análise e Desenvolvimento de Sistemas'


def quadro_cena(nome, indice):
    fs = sorted(f for f in os.listdir(os.path.join(CENAS, nome)) if f.endswith('.jpg'))
    return Image.open(os.path.join(CENAS, nome, fs[min(indice, len(fs) - 1)])).convert('RGB')


def colar_tela(base, tela, caixa, raio, borda=(58, 58, 66)):
    """Cola um print com cantos arredondados, sombra e contorno fino."""
    x0, y0, x1, y1 = caixa
    tela = tela.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    sombra = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sombra).rounded_rectangle([x0 - 6, y0 + 18, x1 + 6, y1 + 40], raio, fill=200)
    sombra = sombra.filter(ImageFilter.GaussianBlur(36))
    base.paste(Image.new('RGB', (W, H), (0, 0, 0)), (0, 0), sombra)
    mask = Image.new('L', tela.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tela.width - 1, tela.height - 1], raio, fill=255)
    base.paste(tela, (x0, y0), mask)
    ImageDraw.Draw(base).rounded_rectangle(caixa, raio, outline=borda, width=2)


def capa():
    """Capa sóbria: autor e projeto à esquerda, telas reais do sistema à direita."""
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip((12, 12, 14), (20, 20, 24))))
    brilho = Image.new('RGB', (W, H), (0, 0, 0))
    ImageDraw.Draw(brilho).ellipse([1000, 60, 2100, 1050], fill=(40, 18, 6))
    img = ImageChops.add(img, brilho.filter(ImageFilter.GaussianBlur(220)))
    # grade fina de fundo
    d = ImageDraw.Draw(img)
    for x in range(0, W, 64):
        d.line([(x, 0), (x, H)], fill=(24, 24, 28))
    for y in range(0, H, 64):
        d.line([(0, y), (W, y)], fill=(24, 24, 28))
    # telas
    colar_tela(img, quadro_cena('salao', 50), (990, 200, 990 + 830, 200 + 467), 14)
    colar_tela(img, quadro_cena('atendente', 381), (1580, 440, 1580 + 250, 440 + 541), 30, (80, 80, 90))
    d = ImageDraw.Draw(img)
    # texto
    x = 150
    texto(d, (x, 300), 'PORTFÓLIO · PROJETO DE SOFTWARE', fonte('SemiBold', 21), LARANJA, 2)
    d.text((x - 4, 350), AUTOR, font=fonte('Bold', 104), fill=BRANCO)
    d.text((x, 482), CURSO, font=fonte('Regular', 28), fill=CINZA)
    d.rectangle([x, 560, x + 64, 564], fill=LARANJA)
    d.text((x, 600), 'Sistema de gestão', font=fonte('SemiBold', 50), fill=BRANCO)
    d.text((x, 662), 'para bares e restaurantes', font=fonte('SemiBold', 50), fill=BRANCO)
    d.text((x, 745), 'PDV · Mesas · Cozinha · Delivery · App do garçom', font=fonte('Regular', 25), fill=CINZA)
    cx = x
    for tag in ['React', 'TypeScript', 'Node.js', 'PostgreSQL']:
        f = fonte('Medium', 21)
        w = d.textlength(tag, font=f)
        d.rounded_rectangle([cx, 812, cx + w + 32, 852], 20, outline=(70, 70, 80), width=2, fill=(22, 22, 26))
        d.text((cx + 16, 820), tag, font=f, fill=(215, 215, 222))
        cx += w + 44
    return img


def intro(d, img):
    logo = Image.open(LOGO).convert('RGBA')
    logo = logo.resize((int(logo.width * 0.78), int(logo.height * 0.78)), Image.LANCZOS)
    img.paste(logo, ((W - logo.width) // 2, 150), logo)
    centro(d, 560, 'Sistema de gestão para bares e lanchonetes', fonte('Bold', 60), BRANCO)
    centro(d, 650, 'PDV  ·  Mesas  ·  Cozinha  ·  Delivery  ·  WhatsApp', fonte('Medium', 32), LARANJA)
    centro(d, 704, 'do pedido ao caixa, em tempo real', fonte('Regular', 30), CINZA)


def tech(d, img):
    texto(d, (200, 150), 'POR TRÁS DO SISTEMA', fonte('Bold', 24), LARANJA, 3)
    d.text((200, 190), 'Feito para o dia a dia da loja', font=fonte('Bold', 64), fill=BRANCO)
    itens = [
        ('Front-end', 'React + TypeScript, PWA (funciona no celular)'),
        ('Back-end', 'Node.js (Fastify) e PostgreSQL'),
        ('Tempo real', 'caixa, garçons e cozinha sincronizados'),
        ('Instalação', 'app para Windows com instalador'),
        ('Qualidade', 'testes automatizados: unidade, integração e E2E'),
        ('Segurança', 'perfis de acesso e backup diário'),
    ]
    for i, (k, v) in enumerate(itens):
        x = 200 + (i % 2) * 780
        y = 360 + (i // 2) * 190
        d.rounded_rectangle([x, y, x + 740, y + 160], 18, fill=(32, 32, 38), outline=(56, 56, 64), width=2)
        d.rectangle([x, y + 30, x + 5, y + 130], fill=LARANJA)
        d.text((x + 36, y + 32), k, font=fonte('Bold', 34), fill=BRANCO)
        d.text((x + 36, y + 88), v, font=fonte('Regular', 26), fill=CINZA)


def fim(d, img):
    logo = Image.open(LOGO).convert('RGBA')
    logo = logo.resize((int(logo.width * 0.62), int(logo.height * 0.62)), Image.LANCZOS)
    img.paste(logo, ((W - logo.width) // 2, 220), logo)
    centro(d, 560, 'Sistema de gestão', fonte('Bold', 60), BRANCO)
    centro(d, 650, 'Em uso real no Bar do Guto', fonte('Regular', 32), CINZA)
    centro(d, 880, 'Dados das telas são fictícios (demonstração)', fonte('Regular', 20), (110, 110, 118))


# ---------- ffmpeg ----------
def ff(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS)]


def seg_estatico(nome, img, dur, zoom=True):
    png = os.path.join(TMP, nome + '.png')
    img.save(png)
    out = os.path.join(TMP, nome + '.mp4')
    n = int(dur * FPS)
    vf = (f"scale=3840:2160,zoompan=z='1+0.03*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS}"
          if zoom else 'null')
    ff('-loop', '1', '-i', png, '-t', str(dur), '-vf', vf, *ENC, out)
    return out


def seg_cena(nome, topo, dur, vel, fone):
    lista = os.path.join(CENAS, nome, 'lista.txt')
    png = os.path.join(TMP, nome + '_topo.png')
    topo.save(png)
    out = os.path.join(TMP, nome + '.mp4')
    if fone:
        x, y, esc = PX, PY, 'scale=390:844:flags=lanczos'
    else:
        x, y, esc = DX, DY, f'scale={DW}:{DH}:flags=lanczos'
    fc = (f"[0:v]fps={FPS},setpts=PTS/{vel},{esc},tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur},setpts=PTS-STARTPTS[v];"
          f"color=c=black:s={W}x{H}:r={FPS}:d={dur}[base];[base][v]overlay={x}:{y}[a];[a][1:v]overlay=0:0,format=yuv420p")
    ff('-f', 'concat', '-safe', '0', '-i', lista, '-loop', '1', '-t', str(dur), '-i', png,
       '-filter_complex', fc, '-t', str(dur), *ENC, out)
    return out


def juntar(segs, saida):
    entradas, fc, prev, t = [], [], '0:v', 0.0
    for i, (p, d) in enumerate(segs):
        entradas += ['-i', p]
        if i == 0:
            t = d
            continue
        off = t - XF
        lbl = f'x{i}'
        fc.append(f'[{prev}][{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[{lbl}]')
        prev, t = lbl, off + d
    fc.append(f'[{prev}]fade=t=in:st=0:d=0.6,fade=t=out:st={t - 0.8:.3f}:d=0.8,format=yuv420p[out]')
    ff(*entradas, '-filter_complex', ';'.join(fc), '-map', '[out]', *ENC, '-movflags', '+faststart', saida)
    return t


CENAS_DEF = [
    ('pdv', False, 12, 1.6, 'Caixa (PDV)', 'Venda rápida no balcão',
     'Acréscimos, retirar ingredientes e troco calculado na hora'),
    ('atendente', True, 9.5, 1.5, 'App do garçom', 'O pedido sai\nda mesa', [
        'Lançado pelo celular', 'Acréscimos em verde', 'Vai direto para a cozinha']),
    ('cozinha', False, 7.5, 1.25, 'Cozinha', 'Pedido chega na hora — na tela e na impressora',
     'Fila por status: novo, em preparo e pronto'),
    ('delivery', True, 12, 1.65, 'Delivery & WhatsApp', 'Entrega com\ntaxa por bairro', [
        'Pedido do WhatsApp em segundos', 'Pix + dinheiro no mesmo pedido', 'Troco já calculado']),
    ('dividir', False, 9, 1.7, 'Fechamento da mesa', 'Conta dividida por itens',
     'Cada cliente paga o que consumiu'),
    ('cardapio', True, 6, 1.3, 'Cardápio digital', 'O cliente pede\nde casa', [
        'Link público do cardápio', 'Pedido entra para aceite']),
    ('salao', False, 6, 1.25, 'Gestão', 'Salão e entregas em tempo real',
     'Mesas, comandas, contas pedidas e entregadores'),
]


def main():
    segs = [(seg_estatico('intro', capa(), 5), 5)]
    for nome, fone, dur, vel, kick, tit, sub in CENAS_DEF:
        topo = topo_fone(kick, tit, sub) if fone else topo_desk(kick, tit, sub)
        segs.append((seg_cena(nome, topo, dur, vel, fone), dur))
        print('ok', nome, flush=True)
    segs.append((seg_estatico('tech', quadro_fixo(tech), 6, zoom=False), 6))
    segs.append((seg_estatico('fim', quadro_fixo(fim), 4.5), 4.5))
    total = juntar(segs, SAIDA)
    print(f'{SAIDA}: {total:.1f}s')


if __name__ == '__main__':
    main()
