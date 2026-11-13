import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
import uuid
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from security import certificate, public_key, b64

class ApiTest(unittest.TestCase):
    def setUp(self):
        self.key=ec.generate_private_key(ec.SECP256R1())
        self.proof=certificate(self.api.AUTHORITY,'organizacao','Organização','organization','',self.api.EVENT,public_key(self.key))
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        os.environ.update(EVENTO_DB=str(Path(cls.temp.name)/'test.sqlite3'),ORG_USER='organizacao',ORG_PASSWORD='Senha-de-teste-123',EVENT_CODE='DEMO-2026')
        spec=importlib.util.spec_from_file_location('evento_server',Path(__file__).with_name('server.py'))
        cls.api=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.api)
        cls.api.initialize()
        cls.server=cls.api.ThreadingHTTPServer(('127.0.0.1',0),cls.api.Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.temp.cleanup()
    def request(self,path,body=None,token=''):
        if body is not None:
            body={**body,'publicKey':public_key(self.key)}
        req=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def login(self):
        code,data=self.request('/api/login',{'username':'organizacao','password':'Senha-de-teste-123'})
        self.assertEqual(code,200);self.assertEqual(data['role'],'organization');return data['token']
    def record(self,kind='bulletin'):
        now=int(time.time()*1000)
        return self.sign(dict(v=2,id=str(uuid.uuid4()),event='DEMO-2026',kind=kind,title='Aviso',text='Conteúdo de teste',sector='Geral',created=now,expires=now+3600000,start=now+1000,end=now+2000,lat=-27.81,lon=-50.32,category='gym',priority='normal',audience='all',teamId='',author='organizacao',authorName='Organização',authorRole='organization'))
    def sign(self,r):
        r={k:v for k,v in r.items() if k not in ('payload','signature','certificate','certificateSignature')}
        raw=json.dumps(r,ensure_ascii=False,separators=(',',':'))
        return dict(r,payload=raw,signature=b64(self.key.sign(raw.encode(),ec.ECDSA(hashes.SHA256()))),
            certificate=self.proof['certificate'],certificateSignature=self.proof['certificateSignature'])
    def test_role_is_not_chosen_by_registration(self):
        code,user=self.request('/api/register',dict(username='atleta',password='Senha-atleta-123',name='Atleta',role='organization'))
        self.assertEqual(code,200);self.assertEqual(user['role'],'athlete')
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[self.record()]},user['token']);self.assertEqual(code,403)
    def test_authenticated_roundtrip_and_idempotency(self):
        token=self.login();r=self.record()
        for _ in range(2):
            code,data=self.request('/api/events/DEMO-2026/sync',{'records':[r]},token)
            self.assertEqual(code,200);self.assertIn(r['id'],data['ack'])
            self.assertEqual(sum(x['id']==r['id'] for x in data['records']),1)
        r['text']='Mudou'
        r=self.sign(r)
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[r]},token);self.assertEqual(code,409)
    def test_validation_atomicity_and_event_isolation(self):
        token=self.login();good=self.record();bad=self.record('facility');bad['lat']=999
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[good,bad]},token);self.assertEqual(code,400)
        _,data=self.request('/api/events/DEMO-2026/sync',{'records':[]},token)
        self.assertNotIn(good['id'],[r['id'] for r in data['records']])
        code,_=self.request('/api/events/OUTRO/sync',{'records':[]},token);self.assertEqual(code,404)
    def test_agenda_facility_and_expired(self):
        token=self.login();agenda=self.record('agenda');place=self.record('facility')
        code,data=self.request('/api/events/DEMO-2026/sync',{'records':[agenda,place]},token)
        self.assertEqual(code,200);self.assertEqual(set(data['ack']),{agenda['id'],place['id']})
        expired=self.record();expired['expires']=expired['created']-1
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[expired]},token);self.assertEqual(code,400)
    def test_login_logout_and_no_plaintext_password(self):
        token=self.login()
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[]});self.assertEqual(code,401)
        self.request('/api/logout',{},token)
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[]},token);self.assertEqual(code,401)
        with self.api.connect() as db:
            stored=db.execute('SELECT password FROM users WHERE username=?',('organizacao',)).fetchone()[0]
            self.assertNotEqual(stored,'Senha-de-teste-123')
            self.assertTrue(self.api.check_password('Senha-de-teste-123',stored))
    def test_ping(self):
        code,data=self.request('/api/ping');self.assertEqual(code,200);self.assertTrue(data['ok'])
    def test_coach_and_athlete_without_approval_join_roundtrip(self):
        suffix=uuid.uuid4().hex[:8]
        coach_name='coach_'+suffix
        code,coach=self.request('/api/register',dict(username=coach_name,password='Senha-de-teste-123',name='Técnico',requestedRole='coach'))
        self.assertEqual(code,200);self.assertEqual(coach['role'],'coach')
        code,created=self.request('/api/manage',dict(op='teamSave',name='Equipe '+suffix,sport='Vôlei',coach='organizacao'),coach['token'])
        self.assertEqual(code,200)
        team=next(t for t in created['teams'] if t['coach']==coach_name)
        self.assertEqual(created['teamId'],team['id'])
        self.assertEqual(json.loads(created['certificate'])['teamId'],team['id'])
        code,athlete=self.request('/api/register',dict(username='ath_'+suffix,password='Senha-de-teste-123',name='Atleta',requestedRole='athlete'))
        self.assertEqual(code,200);self.assertEqual(athlete['role'],'athlete')
        code,joined=self.request('/api/manage',dict(op='teamJoin',teamId=team['id'],username=coach_name),athlete['token'])
        self.assertEqual(code,200);self.assertEqual(joined['teamId'],team['id'])
        self.assertEqual(json.loads(joined['certificate'])['teamId'],team['id'])
        code,fresh=self.request('/api/events/DEMO-2026/sync',dict(records=[]),coach['token'])
        self.assertEqual(code,200)
        roster=next(t['members'] for t in fresh['teams'] if t['id']==team['id'])
        self.assertEqual(roster[0]['username'],athlete['username'])
        code,_=self.request('/api/manage',dict(op='teamSave',name='Não',sport='Vôlei'),athlete['token'])
        self.assertEqual(code,403)
        code,left=self.request('/api/manage',dict(op='teamLeave'),athlete['token'])
        self.assertEqual(code,200);self.assertEqual(left['teamId'],'')

    def test_previous_pending_coach_migrates_without_password_change(self):
        username='pending_'+uuid.uuid4().hex[:8]
        stored=self.api.password_hash('Senha-de-teste-123')
        with self.api.connect() as db:
            db.execute('INSERT INTO users(username,password,name,role,requested_role) VALUES(?,?,?,?,?)',
                       (username,stored,'Anterior','athlete','coach'))
        self.api.initialize()
        code,user=self.request('/api/login',dict(username=username,password='Senha-de-teste-123'))
        self.assertEqual(code,200);self.assertEqual(user['role'],'coach')

    def new_user(self, role):
        name=role+'_'+uuid.uuid4().hex[:8]
        code,u=self.request('/api/register',dict(username=name,password='Senha-de-teste-123',name=name,requestedRole=role))
        self.assertEqual(code,200)
        if role=='coach':
            code,updated=self.request('/api/manage',dict(op='teamSave',name=name,sport='Vôlei'),u['token'])
            self.assertEqual(code,200);u.update(updated)
        return u

    def upload(self, token, data=b'%PDF-1.4\nconteudo de teste', mime='application/pdf'):
        req=urllib.request.Request(self.base+'/api/attachments',data=data,headers={
            'Authorization':'Bearer '+token,'Content-Type':mime,'X-File-Name':'Boletim.pdf'})
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)

    def download(self, token, ident):
        req=urllib.request.Request(self.base+'/api/attachments/'+ident,headers={'Authorization':'Bearer '+token})
        try:
            with urllib.request.urlopen(req) as r:return r.status,r.read()
        except urllib.error.HTTPError as e:return e.code,e.read()

    def revision(self, original, deleted=False):
        item=dict(original,id=str(uuid.uuid4()),created=int(time.time()*1000)+10,
                  replaces=original['id'],original=original,deleted=deleted,title='Publicação alterada')
        return self.sign(item)

    def test_edit_delete_signed_roundtrip_immutable_history(self):
        token=self.login()
        for kind in ('notice','agenda','bulletin'):
            original=self.record(kind)
            edit=self.revision(original)
            deleted=self.sign(dict(edit,id=str(uuid.uuid4()),created=edit['created']+1,deleted=True))
            code,out=self.request('/api/events/DEMO-2026/sync',{'records':[original,edit,deleted]},token)
            self.assertEqual(code,200,out)
            self.assertEqual(set(out['ack']),{original['id'],edit['id'],deleted['id']})
            self.assertTrue(any(r.get('deleted') and r.get('replaces')==original['id'] for r in out['records']))

    def test_coach_create_edit_bulletin_agenda_and_notice(self):
        coach=self.new_user('coach')
        self.proof=coach
        for kind in ('notice','agenda','bulletin'):
            original=self.sign(dict(self.record(kind),author=coach['username'],authorName=coach['username'],
                                    authorRole='coach',teamId=coach['teamId'],audience='team'))
            edit=self.revision(original)
            delete=self.sign(dict(edit,id=str(uuid.uuid4()),created=edit['created']+1,deleted=True))
            code,data=self.request('/api/events/DEMO-2026/sync',{'records':[original,edit,delete]},coach['token'])
            self.assertEqual(code,200,data)

    def test_coach_cannot_edit_other_author_or_change_audience(self):
        token=self.login()
        original=self.record('notice')
        coach=self.new_user('coach');self.proof=coach
        forged=self.sign(dict(self.revision(original),author=coach['username'],authorName=coach['username'],
                               authorRole='coach',teamId=coach['teamId'],audience='team'))
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[forged]},coach['token'])
        self.assertEqual(code,403)
        org=self.login()
        self.proof=certificate(self.api.AUTHORITY,'organizacao','Organização','organization','',self.api.EVENT,public_key(self.key))
        changed=self.sign(dict(self.revision(original),audience='team',teamId=coach['teamId']))
        code,_=self.request('/api/events/DEMO-2026/sync',{'records':[changed]},org)
        self.assertEqual(code,403)

    def test_attachment_upload_download_and_athlete_readonly(self):
        org=self.login(); athlete=self.new_user('athlete')
        self.assertEqual(self.upload('',b'%PDF-1.4')[0],401)
        self.assertEqual(self.upload(athlete['token'])[0],403)
        self.assertEqual(self.upload(org,b'<script>invalido</script>')[0],400)
        code,out=self.upload(org);self.assertEqual(code,200)
        meta=out['attachment']
        record=self.sign(dict(self.record(),attachment=meta,link='https://example.com/boletim'))
        code,data=self.request('/api/events/DEMO-2026/sync',{'records':[record]},org)
        self.assertEqual(code,200,data)
        self.assertEqual(self.download(athlete['token'],meta['id']),(200,b'%PDF-1.4\nconteudo de teste'))
        self.assertEqual(self.download('',meta['id'])[0],401)
        self.assertEqual(self.download(org,'../../server.py')[0],404)
        bad=self.sign(dict(self.record(),link='javascript:alert(1)'))
        self.assertEqual(self.request('/api/events/DEMO-2026/sync',{'records':[bad]},org)[0],400)
        bad=self.sign(dict(self.record(),attachment=dict(meta,sha256='0'*64)))
        self.assertEqual(self.request('/api/events/DEMO-2026/sync',{'records':[bad]},org)[0],400)

    def test_team_attachment_visibility_and_metadata_integrity(self):
        coach=self.new_user('coach');athlete=self.new_user('athlete')
        code,out=self.upload(coach['token']);self.assertEqual(code,200)
        meta=out['attachment']
        self.assertEqual(self.download(athlete['token'],meta['id'])[0],403)
        self.request('/api/manage',dict(op='teamJoin',teamId=coach['teamId']),athlete['token'])
        self.assertEqual(self.download(athlete['token'],meta['id'])[0],200)
        self.proof=coach
        record=self.sign(dict(self.record(),author=coach['username'],authorName=coach['username'],
                              authorRole='coach',audience='team',teamId=coach['teamId'],attachment=meta))
        code,data=self.request('/api/events/DEMO-2026/sync',{'records':[record]},coach['token'])
        self.assertEqual(code,200,data)
        _,received=self.request('/api/events/DEMO-2026/sync',{'records':[]},athlete['token'])
        self.assertIn(record['id'],[r['id'] for r in received['records']])
        other=self.new_user('athlete')
        _,received=self.request('/api/events/DEMO-2026/sync',{'records':[]},other['token'])
        self.assertNotIn(record['id'],[r['id'] for r in received['records']])
if __name__=='__main__':unittest.main()
