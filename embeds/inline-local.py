"""Встраивает локальный скриншот в лендинг как data:URI (WebP).
Запуск: python3 embeds/inline-local.py <картинка> <имя-в-src, напр. card-toprates-ru.png> <slug для embeds/img>
"""
import base64, sys
from PIL import Image

src, target, slug = sys.argv[1:4]
im = Image.open(src).convert("RGB")
out = f"embeds/img/{slug}.webp"
im.save(out, "WEBP", quality=82, method=6)
data = open(out, "rb").read()
p = "embeds/fundoor-landing.html"
html = open(p, encoding="utf-8").read()
old = f'src="https://fundoor.pro/screenshots/{target}"'
assert html.count(old) == 1, f"{old} не найден"
html = html.replace(old, f'src="data:image/webp;base64,{base64.b64encode(data).decode()}" width="{im.width}" height="{im.height}"')
open(p, "w", encoding="utf-8").write(html)
print(f"{slug}: {len(data)//1024} KB, лендинг {len(html.encode())//1024} KB")
