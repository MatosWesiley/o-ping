#!/usr/bin/env python3
"""Evento Perto development API. Put behind HTTPS for internet deployment."""
import hashlib
import getpass
import sys
import socket
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from administration import manage, teams_for, users_for, Rejected
from security import load_authority, certificate, public_key, unpack_record
from attachments import save_file, read_file, valid_attachment, MAX_FILE, directory
from urllib.parse import urlparse, unquote

DB = os.environ.get('EVENTO_DB', str(Path(__file__).with_name('evento.sqlite3')))
EVENT = os.environ.get('EVENT_CODE', 'DEMO-2026')
SESSION_SECONDS = 7 * 86400
MAX_BODY = 4_000_000
AUTHORITY = None

@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=10)
    try:
        db.execute('PRAGMA journal_mode=WAL')
        with db:
            yield db
    finally:
        db.close()

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 260000).hex()
    return salt + ':' + digest

def check_password(password, encoded):
    return hmac.compare_digest(password_hash(password, encoded.split(':')[0]), encoded)

def initialize():
    global AUTHORITY
    with connect() as db:
        db.executescript('''
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(event TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(event,id));
CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,sport TEXT NOT NULL,coach TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,name TEXT NOT NULL,number TEXT NOT NULL,position TEXT NOT NULL,username TEXT NOT NULL DEFAULT '');
''')
        columns = {r[1] for r in db.execute('PRAGMA table_info(users)')}
        for col in ('team_id', 'requested_role'):
            if col not in columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
        db.execute("UPDATE users SET requested_role=role WHERE requested_role=''")
        # Presentation version: athlete/coach accounts no longer need organizer approval.
        db.execute("UPDATE users SET role='coach' WHERE role='athlete' AND requested_role='coach'")
        user = os.environ.get('ORG_USER', 'organizacao').lower()
        password = os.environ.get('ORG_PASSWORD', '')
        if not re.fullmatch(r'[a-z0-9_.-]{3,40}', user):
            raise ValueError('ORG_USER inválido')
        if len(password) < 10:
            raise ValueError('Defina ORG_PASSWORD com pelo menos 10 caracteres. Nenhuma senha padrão é criada.')
        row = db.execute('SELECT username FROM users WHERE username=?', (user,)).fetchone()
        if not row:
            db.execute('INSERT INTO users(username,password,name,role,requested_role) VALUES(?,?,?,?,?)', (user, password_hash(password), 'Organização', 'organization', 'organization'))
    AUTHORITY = load_authority(DB)

def valid_record(o):
    try:
        if not isinstance(o, dict) or o.get('event') != EVENT or o.get('v') != 2:
            return False
        uuid.UUID(o['id'])
        for key, maximum in [('title', 80), ('text', 500), ('sector', 40)]:
            if not isinstance(o.get(key), str) or not 1 <= len(o[key].strip()) <= maximum:
                return False
        now = int(time.time()*1000)
        created, expiry = o['created'], o['expires']
        if not isinstance(created, int) or not isinstance(expiry, int) or created <= 0 or created > now+300000 or expiry <= now or not 0 < expiry-created <= 7*86400000:
            return False
        kind = o['kind']
        if kind not in ('bulletin', 'notice', 'agenda', 'facility'):
            return False
        if o.get('priority') not in ('normal','important','emergency'):
            return False
        if o.get('audience') not in ('all','team') or not isinstance(o.get('teamId'),str):
            return False
        if o['audience']=='team' and not o['teamId']:
            return False
        if o['priority']=='emergency' and (kind!='notice' or o['audience']!='all' or o.get('authorRole')!='organization'):
            return False
        if kind == 'agenda' and not 0 < o['start'] < o['end'] <= expiry:
            return False
        if kind == 'facility':
            if o.get('category') not in ('gym','lodging'):
                return False
            if not all(isinstance(o.get(k),(float,int)) and not isinstance(o[k],bool) and math.isfinite(o[k]) for k in ('lat','lon')):
                return False
            if not (-90<=o['lat']<=90 and -180<=o['lon']<=180):
                return False
        if o.get('replaces'):
            uuid.UUID(o['replaces'])
            if not isinstance(o.get('original'), dict) or not isinstance(o.get('deleted'), bool):
                return False
            if expiry < o['original'].get('expires', 0):
                return False
        if 'attachment' in o and (kind != 'bulletin' or not valid_attachment(o['attachment'])):
            return False
        if o.get('link'):
            link = urlparse(o['link'])
            if kind != 'bulletin' or len(o['link']) > 1500 or link.scheme not in ('http', 'https') or not link.netloc or link.username or link.password:
                return False
        return len(json.dumps(o, ensure_ascii=False).encode()) <= 32768
    except (KeyError,ValueError,TypeError):
        return False

class Handler(BaseHTTPRequestHandler):
    server_version = 'Ping/0.5'
    def log_message(self, fmt, *args):
        # Never log tokens, request bodies or passwords.
        pass
    def reply(self, status, body):
        data=json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)
    def body(self):
        length=int(self.headers.get('Content-Length','0'))
        if length<=0 or length>MAX_BODY:
            raise ValueError('Tamanho de requisição inválido')
        result=json.loads(self.rfile.read(length))
        if not isinstance(result,dict):
            raise ValueError('Objeto JSON obrigatório')
        return result
    def current_user(self, db):
        auth=self.headers.get('Authorization','')
        if not auth.startswith('Bearer '): return None
        token_hash=hashlib.sha256(auth[7:].encode()).hexdigest()
        return db.execute('SELECT u.username,u.name,u.role,u.team_id,u.requested_role FROM sessions s JOIN users u ON u.username=s.username WHERE s.token_hash=? AND s.expires>?',(token_hash,int(time.time()))).fetchone()
    def do_GET(self):
        if self.path=='/api/ping':
            self.reply(200,{'ok':True,'time':int(time.time()*1000)});return
        if self.path.startswith('/api/attachments/'):
            try:
                with connect() as db:
                    user = self.current_user(db)
                    if not user:
                        self.reply(401, {'error': 'Entre novamente'}); return
                    meta, data = read_file(DB, user, self.path.removeprefix('/api/attachments/'), EVENT)
                self.send_response(200)
                self.send_header('Content-Type', meta['mime'])
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'private, no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                self.wfile.write(data)
            except Rejected as e:
                self.reply(e.status, {'error': str(e)})
            return
        self.reply(404,{'error':'Não encontrado'})
    def do_POST(self):
        try:
            if self.path == '/api/attachments':
                with connect() as db:
                    user = self.current_user(db)
                    if not user:
                        self.reply(401, {'error': 'Entre novamente'}); return
                    if user[2] not in ('coach', 'organization'):
                        self.reply(403, {'error': 'Atletas não podem enviar arquivos'}); return
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= MAX_FILE:
                        self.reply(400, {'error': 'Limite de 10 MB por arquivo'}); return
                    data = self.rfile.read(length)
                    if len(data) != length:
                        raise ValueError()
                    item = save_file(DB, user, unquote(self.headers.get('X-File-Name', 'arquivo')),
                                     self.headers.get('Content-Type', ''), data, EVENT)
                    self.reply(200, {'attachment': item}); return
            o=self.body()
            with connect() as db:
                if self.path in ('/api/login','/api/register'):
                    username=o.get('username','').strip().lower()
                    password=o.get('password','')
                    if not isinstance(password,str) or len(password)>128 or not re.fullmatch(r'[a-z0-9_.-]{3,40}',username):
                        self.reply(400,{'error':'Usuário ou senha inválidos'});return
                    if self.path=='/api/register':
                        name=o.get('name','').strip()
                        if not 1<=len(name)<=60 or len(password)<10:
                            self.reply(400,{'error':'Nome obrigatório e senha com pelo menos 10 caracteres'});return
                        requested=o.get('requestedRole','athlete')
                        if requested not in ('athlete','coach','organization'):
                            self.reply(400,{'error':'Perfil solicitado inválido'});return
                        try:
                            role = requested if requested in ('athlete','coach') else 'athlete'
                            db.execute('INSERT INTO users(username,password,name,role,requested_role) VALUES(?,?,?,?,?)',(username,password_hash(password),name,role,requested))
                        except sqlite3.IntegrityError:
                            self.reply(409,{'error':'Usuário já cadastrado'});return
                    row=db.execute('SELECT password,name,role,team_id,requested_role FROM users WHERE username=?',(username,)).fetchone()
                    if not row or not check_password(password,row[0]):
                        self.reply(401,{'error':'Usuário ou senha incorretos'});return
                    proof=certificate(AUTHORITY, username,row[1],row[2],row[3],EVENT,o.get('publicKey',''))
                    token=secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<=?',(int(time.time()),))
                    db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),username,int(time.time())+SESSION_SECONDS))
                    db.commit()
                    self.reply(200,{'token':token,'role':row[2],'teamId':row[3],'requestedRole':row[4],'name':row[1],'username':username,'event':EVENT,**proof});return
                user=self.current_user(db)
                if not user:
                    self.reply(401,{'error':'Sessão inválida ou expirada. Entre novamente.'});return
                if self.path=='/api/logout':
                    token=self.headers.get('Authorization','')[7:]
                    db.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))
                    db.commit();self.reply(200,{'ok':True});return
                if self.path=='/api/manage':
                    db.execute("BEGIN IMMEDIATE")
                    user=self.current_user(db)
                    if not user:
                        self.reply(401,{'error':'Sessão inválida ou expirada. Entre novamente.'});return
                    key=o.get('publicKey')
                    if key:
                        certificate(AUTHORITY,user[0],user[1],user[2],user[3],EVENT,key)
                    manage(db,user,o)
                    user=self.current_user(db)
                    proof=certificate(AUTHORITY,user[0],user[1],user[2],user[3],EVENT,key) if key else {}
                    result={'ok':True,'teams':teams_for(db,user),'users':users_for(db,user),
                            'role':user[2],'teamId':user[3],'requestedRole':user[4],**proof}
                    db.commit()
                    self.reply(200,result);return
                if self.path!=f'/api/events/{EVENT}/sync':
                    self.reply(404,{'error':'Código de evento não corresponde ao servidor'});return
                incoming=o.get('records',[])
                proof=certificate(AUTHORITY,user[0],user[1],user[2],user[3],EVENT,o.get('publicKey',''))
                if not isinstance(incoming,list) or len(incoming)>500:
                    self.reply(400,{'error':'Lote inválido'});return
                if incoming and user[2] not in ('organization','coach'):
                    self.reply(403,{'error':'Atletas só podem visualizar avisos'});return
                if any(not valid_record(n) for n in incoming):
                    self.reply(400,{'error':'Publicação inválida ou vencida'});return
                for n in incoming:
                    data=unpack_record(n,public_key(AUTHORITY),EVENT)
                    if not data or data.get('author')!=user[0] or data.get('authorRole')!=user[2]:
                        self.reply(403,{'error':'Assinatura ou permissão de publicação inválida. Entre novamente.'});return
                    if user[2]=='coach' and (data.get('teamId')!=user[3] or not user[3]):
                        self.reply(403,{'error':'O técnico só pode enviar avisos para sua equipe atual'});return
                    if data.get('audience')=='team' and not db.execute('SELECT 1 FROM teams WHERE id=?',(data.get('teamId'),)).fetchone():
                        self.reply(400,{'error':'Equipe de destino não encontrada'});return
                    if n.get('attachment'):
                        meta, _ = read_file(DB, user, n['attachment']['id'], EVENT)
                        if any(meta[k] != n['attachment'][k] for k in ('name', 'mime', 'size', 'sha256')):
                            self.reply(400, {'error': 'Anexo alterado'}); return
                        if meta['teamId'] and (n.get('audience') != 'team' or n.get('teamId') != meta['teamId']):
                            self.reply(403, {'error': 'Anexo restrito à equipe de destino'}); return
                # Validate all before mutating. IDs are immutable: a collision never overwrites.
                ack=[]
                for n in incoming:
                    canonical=json.dumps(n,ensure_ascii=False,sort_keys=True,separators=(',',':'))
                    row=db.execute('SELECT body FROM records WHERE event=? AND id=?',(EVENT,n['id'])).fetchone()
                    if row and row[0]!=canonical:
                        self.reply(409,{'error':'ID em conflito; nenhuma publicação foi substituída'});return
                for n in incoming:
                    canonical=json.dumps(n,ensure_ascii=False,sort_keys=True,separators=(',',':'))
                    db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?,?)',(EVENT,n['id'],canonical,n['expires']))
                    ack.append(n['id'])
                db.execute('DELETE FROM records WHERE expires<=?',(int(time.time()*1000),))
                rows=db.execute('SELECT body FROM records WHERE event=? ORDER BY expires DESC LIMIT 500',(EVENT,)).fetchall()
                db.commit()
                visible=[]
                for r in rows:
                    n=json.loads(r[0])
                    if n.get('payload') and (n.get('audience')=='all' or user[2]=='organization' or n.get('teamId')==user[3]):
                        visible.append(n)
                self.reply(200,{'records':visible,'ack':ack,'teams':teams_for(db,user),'users':users_for(db,user),
                    'role':user[2],'teamId':user[3],'requestedRole':user[4],**proof})
        except Rejected as e:
            self.reply(e.status,{'error':str(e)})
        except (ValueError,TypeError,AttributeError,json.JSONDecodeError):
            self.reply(400,{'error':'Requisição inválida'})
        except Exception:
            self.reply(500,{'error':'Falha interna'})

def main():
    global EVENT
    if '--setup' in sys.argv:
        print('PING — servidor de teste local')
        print('A primeira execução cria a conta da organização. Use a mesma pasta para manter contas e publicações.')
        EVENT = input('Código do evento [DEMO-2026]: ').strip().upper() or 'DEMO-2026'
        if not re.fullmatch(r'[A-Z0-9-]{3,32}', EVENT):
            raise ValueError('Código inválido')
        os.environ['ORG_USER'] = input('Usuário da organização [organizacao]: ').strip().lower() or 'organizacao'
        os.environ['ORG_PASSWORD'] = getpass.getpass('Senha da organização (10 caracteres ou mais): ')
        os.environ['HOST'] = '0.0.0.0'
        print('Conecte computador e celulares ao mesmo Wi-Fi. No app, use http://IP-DO-COMPUTADOR:8787')
        print('O IP aparece no comando ipconfig (Endereço IPv4). Nunca use localhost no celular físico.')
    initialize()
    host=os.environ.get('HOST','127.0.0.1')
    port=int(os.environ.get('PORT','8787'))
    print(f'Evento Perto: {EVENT}, escutando em {host}:{port}. Use HTTPS para acesso pela internet.',flush=True)
    ThreadingHTTPServer((host,port),Handler).serve_forever()
if __name__=='__main__':
    main()
