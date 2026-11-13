"""Portable local-server file storage. File bytes never enter SQLite."""
import hashlib
import json
import re
import uuid
from pathlib import Path
from administration import Rejected

MAX_FILE = 10 * 1024 * 1024
MIMES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

def directory(db):
    return Path(str(db) + ".files")

def save_file(db, user, name, mime, data, event):
    if user[2] not in ("coach", "organization") or (user[2] == "coach" and not user[3]):
        raise Rejected("Somente técnicos com equipe e organizadores podem anexar arquivos", 403)
    if mime not in MIMES or not 0 < len(data) <= MAX_FILE:
        raise Rejected("Use PDF, JPG, PNG ou WebP de até 10 MB", 400)
    valid = ((mime == "application/pdf" and data.startswith(b"%PDF-")) or
             (mime == "image/jpeg" and data.startswith(b"\xff\xd8\xff")) or
             (mime == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n")) or
             (mime == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP"))
    if not valid:
        raise Rejected("O conteúdo não corresponde ao tipo de arquivo", 400)
    ident = str(uuid.uuid4())
    folder = directory(db)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    used = sum(p.stat().st_size for p in folder.iterdir() if p.is_file())
    if used + len(data) > 512 * 1024 * 1024:
        raise Rejected("Armazenamento de anexos cheio (512 MB). Contate a organização", 413)
    metadata = dict(id=ident, name=re.sub(r"[^ \w.()-]", "_", name)[:100] or "arquivo",
                    mime=mime, size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                    owner=user[0], teamId=user[3] if user[2] == "coach" else "", event=event)
    (folder / ident).write_bytes(data)
    (folder / (ident + ".json")).write_text(json.dumps(metadata), encoding="utf8")
    return {k: metadata[k] for k in ("id", "name", "mime", "size", "sha256")}

def read_file(db, user, ident, event):
    try:
        if str(uuid.UUID(ident)) != ident:
            raise ValueError()
        folder = directory(db)
        meta = json.loads((folder / (ident + ".json")).read_text())
    except (ValueError, FileNotFoundError):
        raise Rejected("Arquivo não encontrado", 404)
    if meta["event"] != event or (meta["teamId"] and user[2] != "organization" and meta["teamId"] != user[3]):
        raise Rejected("Arquivo destinado a outra equipe", 403)
    try:
        return meta, (folder / ident).read_bytes()
    except FileNotFoundError:
        raise Rejected("Arquivo não encontrado", 404)

def valid_attachment(value):
    if not isinstance(value, dict):
        return False
    try:
        return (str(uuid.UUID(value["id"])) == value["id"] and value["mime"] in MIMES and
                isinstance(value["name"], str) and 1 <= len(value["name"]) <= 100 and
                isinstance(value["size"], int) and 0 < value["size"] <= MAX_FILE and
                bool(re.fullmatch("[a-f0-9]{64}", value["sha256"])))
    except (ValueError, KeyError, TypeError):
        return False
