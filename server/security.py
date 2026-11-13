"""Signed, offline-verifiable publishing certificates. Private authority key stays on server."""
import base64
import json
import os
import time
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature


def b64(data):
    return base64.b64encode(data).decode("ascii")


def public_key(key):
    return b64(key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))


def load_authority(db_path):
    path = Path(str(db_path) + ".authority.pem")
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    else:
        key = ec.generate_private_key(ec.SECP256R1())
        data = key.private_bytes(serialization.Encoding.PEM,
                                serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    return key


def verify(key, message, signature):
    try:
        key.verify(base64.b64decode(signature, validate=True),
                   message.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return True
    except (ValueError, TypeError, InvalidSignature):
        return False


def read_public(encoded):
    key = serialization.load_der_public_key(base64.b64decode(encoded, validate=True))
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("Chave de publicação inválida")
    return key


def certificate(authority, username, name, role, team_id, event, encoded_key):
    read_public(encoded_key)
    payload = json.dumps(dict(username=username, name=name, role=role, teamId=team_id,
                              event=event, publicKey=encoded_key,
                              expires=int(time.time()*1000) + 7*86400000),
                         ensure_ascii=False, separators=(",", ":"))
    signature = b64(authority.sign(payload.encode(), ec.ECDSA(hashes.SHA256())))
    return dict(certificate=payload, certificateSignature=signature,
                serverPublicKey=public_key(authority))


def unpack_record(record, authority_public, event, historical=False):
    """Reject unsigned or altered Nearby records instead of trusting the declared role."""
    try:
        cert_raw, payload = record["certificate"], record["payload"]
        if not verify(read_public(authority_public), cert_raw, record["certificateSignature"]):
            return None
        cert, data = json.loads(cert_raw), json.loads(payload)
        if not isinstance(cert,dict) or not isinstance(data,dict):
            return None
        if cert["event"] != event or (not historical and cert["expires"] <= int(time.time()*1000)):
            return None
        if not verify(read_public(cert["publicKey"]), payload, record["signature"]):
            return None
        if any(record.get(k) != v for k, v in data.items()):
            return None
        if any(k in data for k in ("payload", "signature", "certificate", "certificateSignature")):
            return None
        if (data.get("author"), data.get("authorRole"), data.get("authorName")) != (
                cert["username"], cert["role"], cert["name"]):
            return None
        if cert["role"] == "coach":
            if (data.get("kind") not in ("notice", "agenda", "bulletin") or not cert["teamId"]
                    or data.get("teamId") != cert["teamId"]
                    or data.get("audience") != "team"
                    or data.get("priority") == "emergency"):
                return None
        elif cert["role"] != "organization":
            return None
        if data.get("replaces"):
            original = data.get("original")
            if not isinstance(original, dict) or original.get("replaces"):
                return None
            root = unpack_record(original, authority_public, event, historical=True)
            if not root or root.get("id") != data["replaces"] or root.get("kind") != data.get("kind"):
                return None
            if root.get("kind") not in ("notice", "agenda", "bulletin"):
                return None
            if (root.get("audience"), root.get("teamId")) != (data.get("audience"), data.get("teamId")):
                return None
            if cert["role"] == "coach" and root.get("author") != cert["username"]:
                return None
        return data
    except (KeyError, ValueError, TypeError, InvalidSignature):
        return None
