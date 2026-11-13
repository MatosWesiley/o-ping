"""Fast in-memory authorization/signature checks; no HTTP server or Android emulator."""
import json
import sqlite3
import unittest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from security import certificate, public_key, unpack_record, b64
from administration import manage, teams_for, Rejected


class SignatureRules(unittest.TestCase):
    def setUp(self):
        self.authority=ec.generate_private_key(ec.SECP256R1())
        self.device=ec.generate_private_key(ec.SECP256R1())

    def record(self,role="organization",team="",audience="all",priority="normal",kind="notice"):
        proof=certificate(self.authority,"publisher","Publicador",role,team,"TEST",public_key(self.device))
        data=dict(event="TEST",author="publisher",authorName="Publicador",authorRole=role,
                  kind=kind,audience=audience,teamId=team,priority=priority,title="Aviso")
        raw=json.dumps(data,ensure_ascii=False,separators=(",",":"))
        return dict(data,payload=raw,signature=b64(self.device.sign(raw.encode(),ec.ECDSA(hashes.SHA256()))),
                    certificate=proof["certificate"],certificateSignature=proof["certificateSignature"])

    def unpack(self,r):
        return unpack_record(r,public_key(self.authority),"TEST")

    def test_organization_emergency_signed(self):
        self.assertIsNotNone(self.unpack(self.record(priority="emergency")))

    def test_tampered_display_content_rejected(self):
        r=self.record();r["title"]="Texto adulterado"
        self.assertIsNone(self.unpack(r))

    def test_unsigned_rejected(self):
        self.assertIsNone(self.unpack(dict(title="Sem assinatura")))

    def test_changed_signature_rejected(self):
        r=self.record();r["signature"]="AAAA"
        self.assertIsNone(self.unpack(r))

    def test_foreign_authority_rejected(self):
        self.assertIsNone(unpack_record(self.record(),public_key(self.device),"TEST"))

    def test_athlete_cannot_publish_even_with_certificate(self):
        self.assertIsNone(self.unpack(self.record(role="athlete")))

    def test_coach_can_only_publish_team_content(self):
        self.assertIsNotNone(self.unpack(self.record(role="coach",team="t1",audience="team")))
        self.assertIsNone(self.unpack(self.record(role="coach",team="t1",audience="all")))
        self.assertIsNone(self.unpack(self.record(role="coach",team="t1",audience="team",priority="emergency")))
        self.assertIsNotNone(self.unpack(self.record(role="coach",team="t1",audience="team",kind="agenda")))
        self.assertIsNotNone(self.unpack(self.record(role="coach",team="t1",audience="team",kind="bulletin")))
        self.assertIsNone(self.unpack(self.record(role="coach",team="t1",audience="team",kind="facility")))


class TeamRules(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript("""
        CREATE TABLE users(username TEXT PRIMARY KEY,name TEXT,role TEXT,team_id TEXT,requested_role TEXT);
        CREATE TABLE teams(id TEXT PRIMARY KEY,name TEXT,sport TEXT,coach TEXT);
        CREATE TABLE members(id TEXT PRIMARY KEY,team_id TEXT,name TEXT,number TEXT,position TEXT,username TEXT);
        INSERT INTO users VALUES('org','Org','organization','','organization');
        INSERT INTO users VALUES('coach','Técnico','coach','t1','coach');
        INSERT INTO users VALUES('athlete','Atleta','athlete','','athlete');
        INSERT INTO teams VALUES('t1','Equipe A','Vôlei','coach');
        INSERT INTO teams VALUES('t2','Equipe B','Futsal','');
        """)
        self.org=("org","Org","organization","","organization")
        self.coach=("coach","Técnico","coach","t1","coach")
        self.athlete=("athlete","Atleta","athlete","","athlete")

    def test_coach_edit_own_roster(self):
        manage(self.db,self.coach,dict(op="memberSave",teamId="t1",name="Atleta",username="athlete"))
        self.assertEqual(teams_for(self.db,self.coach)[0]["members"][0]["username"],"athlete")
        self.assertEqual(self.db.execute("SELECT team_id FROM users WHERE username='athlete'").fetchone()[0],"t1")

    def test_coach_cannot_modify_other_roster(self):
        with self.assertRaises(Rejected):
            manage(self.db,self.coach,dict(op="memberSave",teamId="t2",name="Atleta"))

    def test_athlete_cannot_modify_roster(self):
        with self.assertRaises(Rejected):
            manage(self.db,self.athlete,dict(op="memberSave",teamId="t1",name="Atleta"))

    def test_coach_cannot_grant_roles(self):
        with self.assertRaises(Rejected):
            manage(self.db,self.coach,dict(op="roleUpdate",username="athlete",role="organization"))

    def test_organization_approves_coach_to_team(self):
        manage(self.db,self.org,dict(op="roleUpdate",username="athlete",role="coach",teamId="t2"))
        self.assertEqual(self.db.execute("SELECT role,team_id FROM users WHERE username='athlete'").fetchone(),("coach","t2"))

    def test_remove_member_unlinks_user(self):
        manage(self.db,self.coach,dict(op="memberSave",teamId="t1",id="m1",name="Atleta",username="athlete"))
        manage(self.db,self.coach,dict(op="memberDelete",teamId="t1",id="m1"))
        self.assertEqual(self.db.execute("SELECT team_id FROM users WHERE username='athlete'").fetchone()[0],"")

    def test_team_visibility(self):
        manage(self.db,self.org,dict(op="memberSave",teamId="t2",name="Privado"))
        listed=teams_for(self.db,self.coach)
        self.assertEqual([t["id"] for t in listed],["t1","t2"])
        self.assertEqual(listed[1]["members"],[])
        self.assertEqual(listed[1]["memberCount"],1)
        self.assertEqual(len(teams_for(self.db,self.org)),2)

    def test_athlete_joins_switches_and_leaves_without_approval(self):
        manage(self.db,self.athlete,dict(op="teamJoin",teamId="t1",username="org"))
        manage(self.db,self.athlete,dict(op="teamJoin",teamId="t1"))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM members WHERE username='athlete'").fetchone()[0],1)
        self.assertEqual(self.db.execute("SELECT team_id FROM users WHERE username='org'").fetchone()[0],"")
        manage(self.db,self.athlete,dict(op="teamJoin",teamId="t2"))
        self.assertEqual(self.db.execute("SELECT team_id FROM members WHERE username='athlete'").fetchone()[0],"t2")
        manage(self.db,self.athlete,dict(op="teamLeave"))
        self.assertEqual(self.db.execute("SELECT team_id FROM users WHERE username='athlete'").fetchone()[0],"")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM members WHERE username='athlete'").fetchone()[0],0)

    def test_join_invalid_team_preserves_previous_membership(self):
        manage(self.db,self.athlete,dict(op="teamJoin",teamId="t1"))
        with self.assertRaises(Rejected):
            manage(self.db,self.athlete,dict(op="teamJoin",teamId="missing"))
        self.assertEqual(self.db.execute("SELECT team_id FROM users WHERE username='athlete'").fetchone()[0],"t1")

    def test_coach_creates_only_own_team(self):
        self.db.execute("INSERT INTO users VALUES('newcoach','Novo técnico','coach','','coach')")
        new=("newcoach","Novo técnico","coach","","coach")
        manage(self.db,new,dict(op="teamSave",name="Equipe C",sport="Natação",coach="coach"))
        id_,owner=self.db.execute("SELECT id,coach FROM teams WHERE name='Equipe C'").fetchone()
        self.assertEqual(owner,"newcoach")
        self.assertEqual(self.db.execute("SELECT team_id FROM users WHERE username='newcoach'").fetchone()[0],id_)
        with self.assertRaises(Rejected):
            manage(self.db,new,dict(op="teamSave",name="Segunda",sport="Vôlei"))
        with self.assertRaises(Rejected):
            manage(self.db,new,dict(op="teamSave",id="t1",name="Invadida",sport="Vôlei"))
        manage(self.db,new,dict(op="teamSave",id=id_,name="Equipe editada",sport="Natação"))

    def test_athlete_cannot_create_team_and_coach_cannot_self_join(self):
        with self.assertRaises(Rejected):
            manage(self.db,self.athlete,dict(op="teamSave",name="Não",sport="Vôlei"))
        with self.assertRaises(Rejected):
            manage(self.db,self.coach,dict(op="teamJoin",teamId="t2"))


if __name__=="__main__":
    unittest.main()
