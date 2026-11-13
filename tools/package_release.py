#!/usr/bin/env python3
"""Package the actual APK + source without caches, databases or private signing keys."""
import argparse
import base64
import hashlib
import html
import re
import shutil
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
assets = root / "app/src/main/assets"
parser = argparse.ArgumentParser()
parser.add_argument("--out", type=Path, default=root.parents[1] / "generated-artifacts/ping")
args = parser.parse_args()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=True)

# The separate browser preview is generated from EXACTLY the same local UI assets.
preview = (assets / "index.html").read_text()
logo_data = 'data:image/jpeg;base64,' + base64.b64encode((assets / "logo.jpeg").read_bytes()).decode()
preview = preview.replace('logo.jpeg', logo_data)
for name in ("leaflet.css", "app.css"):
    preview = preview.replace(f'<link rel="stylesheet" href="{name}">',
                              "<style>" + (assets / name).read_text() + "</style>")
preview = preview.replace('<script src="leaflet.js"></script>',
                          "<script>window.PING_PREVIEW=true;</script><script>" +
                          (assets / "leaflet.js").read_text().replace("</script", "<\\/script") + "</script>")
preview = preview.replace('<script src="app.js"></script>',
                          "<script>" + (assets / "app.js").read_text().replace('logo.jpeg', logo_data).replace("</script", "<\\/script") + "</script>")
(root / "PREVIA-PING.html").write_text(preview)

def inline(s):
    escaped = html.escape(s)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)

def markdown(text):
    result, code, paragraph = [], False, []
    def flush():
        if paragraph:
            result.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            paragraph.clear()
    for line in text.splitlines():
        if line.startswith("```"):
            flush()
            result.append("</code></pre>" if code else "<pre><code>")
            code = not code
        elif code:
            result.append(html.escape(line) + "\n")
        elif line.startswith("#"):
            flush()
            n = min(len(line)-len(line.lstrip("#")), 6)
            result.append(f"<h{n}>" + inline(line[n:].strip()) + f"</h{n}>")
        elif not line.strip():
            flush()
        elif line.startswith("- ") or re.match(r"^\d+\.\s", line):
            flush(); result.append('<p class="item">' + inline(line) + "</p>")
        else:
            paragraph.append(line)
    flush()
    return "\n".join(result)

guide = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Guia de uso · Ping 0.5</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f0fb;color:#281f34;font:16px/1.7 system-ui,sans-serif}
main{max-width:860px;margin:32px auto;padding:40px;background:white;border-radius:24px}
h1{color:#7218d4;line-height:1.2}h2{margin-top:40px;border-top:1px solid #e5dced;padding-top:22px;line-height:1.3}
pre{background:#241832;color:white;padding:18px;border-radius:12px;overflow:auto;white-space:pre-wrap}
code{font:14px ui-monospace,monospace;background:#eee6f6;padding:2px 5px;border-radius:4px}
pre code{background:none;padding:0}strong{color:#522080}.item{padding-left:16px;margin:7px 0}
@media(max-width:600px){main{margin:0;border-radius:0;padding:24px 18px}}</style></head><body><main>""" + \
    markdown((root / "GUIA.md").read_text()) + "</main></body></html>"
(out / "GUIA-PING.html").write_text(guide)
apk = root / "app/build/outputs/apk/debug/app-debug.apk"
if not apk.exists():
    raise SystemExit("Compile assembleDebug antes de empacotar. Nenhum APK foi criado.")
shutil.copy2(apk, out / "Ping-0.5-debug.apk")

excluded_dirs = {".git", ".gradle", "build", "__pycache__", ".idea", ".pythonlibs", "APKs"}
with zipfile.ZipFile(out / "Ping-0.5-projeto.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if not path.is_file() or any(p in excluded_dirs or p.endswith(".sqlite3.files") or p.startswith(".venv") for p in relative.parts):
            continue
        if path.name == "local.properties" or ".sqlite3" in path.name or path.suffix in {".pem", ".keystore", ".jks", ".pyc", ".apk"}:
            continue
        z.write(path, Path("evento-perto") / relative)
sums = []
for name in ("Ping-0.5-debug.apk", "Ping-0.5-projeto.zip", "GUIA-PING.html"):
    digest = hashlib.sha256((out / name).read_bytes()).hexdigest()
    sums.append(f"{digest}  {name}")
(out / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n")
print("Pacote gerado. APK, fonte, guia e SHA256SUMS prontos.")
