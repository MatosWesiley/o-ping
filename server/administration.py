"""Event roles, teams and roster authorization. No client-supplied role is trusted."""
import re
import uuid


class Rejected(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def text(o, key, maximum, required=True):
    value = o.get(key, "")
    if not isinstance(value, str):
        raise Rejected("Campo inválido: " + key)
    value = value.strip()
    if (required and not value) or len(value) > maximum:
        raise Rejected("Confira o campo: " + key)
    return value


def teams_for(db, user):
    rows = db.execute("SELECT id,name,sport,coach FROM teams ORDER BY name").fetchall()
    result = []
    for id_, name, sport, coach in rows:
        can_read_roster = user[2] == "organization" or id_ == user[3]
        members = [dict(id=r[0], name=r[1], number=r[2], position=r[3], username=r[4])
                   for r in db.execute(
                       "SELECT id,name,number,position,username FROM members WHERE team_id=? ORDER BY name",
                       (id_,))] if can_read_roster else []
        count = db.execute("SELECT COUNT(*) FROM members WHERE team_id=?", (id_,)).fetchone()[0]
        result.append(dict(id=id_, name=name, sport=sport, coach=coach, members=members, memberCount=count))
    return result


def users_for(db, user):
    if user[2] != "organization":
        return []
    return [dict(username=r[0], name=r[1], role=r[2], requestedRole=r[3], teamId=r[4])
            for r in db.execute("SELECT username,name,role,requested_role,team_id FROM users ORDER BY name")]


def manage(db, user, o):
    op = o.get("op")
    org = user[2] == "organization"
    if op in ("refreshTeams", "refreshUsers"):
        if op == "refreshUsers" and not org:
            raise Rejected("Acesso exclusivo da organização", 403)
        return
    if op in ("teamJoin", "teamLeave"):
        if user[2] != "athlete":
            raise Rejected("Somente atletas entram em equipes por este menu", 403)
        team = text(o, "teamId", 80) if op == "teamJoin" else ""
        if team and not db.execute("SELECT 1 FROM teams WHERE id=?", (team,)).fetchone():
            raise Rejected("Equipe não encontrada", 404)
        current = db.execute("SELECT team_id FROM users WHERE username=?", (user[0],)).fetchone()[0]
        if current == team and (not team or db.execute(
                "SELECT 1 FROM members WHERE username=? AND team_id=?", (user[0], team)).fetchone()):
            return
        # Move membership atomically. Never let a client select another account.
        db.execute("DELETE FROM members WHERE username=?", (user[0],))
        if team:
            db.execute("INSERT INTO members VALUES(?,?,?,?,?,?)",
                       (str(uuid.uuid4()), team, user[1], "", "", user[0]))
        db.execute("UPDATE users SET team_id=? WHERE username=?", (team, user[0]))
        return
    if op == "roleUpdate":
        if not org:
            raise Rejected("Apenas a organização aprova perfis", 403)
        username = text(o, "username", 40)
        role = o.get("role")
        team = text(o, "teamId", 80, False)
        if username == user[0]:
            raise Rejected("Não é permitido alterar seu próprio acesso.")
        if role not in ("organization", "coach", "athlete"):
            raise Rejected("Perfil inválido")
        if not db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise Rejected("Usuário não encontrado", 404)
        if role == "organization":
            team = ""
        if team and not db.execute("SELECT 1 FROM teams WHERE id=?", (team,)).fetchone():
            raise Rejected("Equipe não encontrada", 404)
        if role == "coach" and team:
            row = db.execute("SELECT coach FROM teams WHERE id=?", (team,)).fetchone()
            if row[0] and row[0] != username:
                raise Rejected("Esta equipe já possui um técnico. Remova a atribuição anterior.")
        db.execute("UPDATE teams SET coach='' WHERE coach=?", (username,))
        db.execute("UPDATE users SET role=?,requested_role=?,team_id=? WHERE username=?",
                   (role, role, team, username))
        db.execute("DELETE FROM members WHERE username=? AND team_id!=?", (username, team))
        if role == "coach":
            db.execute("UPDATE teams SET coach=? WHERE id=?", (username, team))
            db.execute("DELETE FROM members WHERE username=?", (username,))
        return
    if op == "teamSave":
        if not org and user[2] != "coach":
            raise Rejected("Apenas técnicos e organização cadastram equipes", 403)
        name, sport = text(o, "name", 80), text(o, "sport", 60)
        id_ = text(o, "id", 80, False) or str(uuid.uuid4())
        coach = text(o, "coach", 40, False)
        existing = db.execute("SELECT coach FROM teams WHERE id=?", (id_,)).fetchone()
        if not org:
            if existing and existing[0] != user[0]:
                raise Rejected("Você só pode editar a equipe que criou", 403)
            assigned = db.execute("SELECT team_id FROM users WHERE username=?", (user[0],)).fetchone()[0]
            if (assigned and assigned != id_) or db.execute(
                    "SELECT 1 FROM teams WHERE coach=? AND id!=?", (user[0], id_)).fetchone():
                raise Rejected("Você já possui uma equipe. Edite a equipe existente.")
            coach = user[0]
        if coach:
            row = db.execute("SELECT role,team_id FROM users WHERE username=?", (coach,)).fetchone()
            if not row or row[0] != "coach":
                raise Rejected("Aprove o perfil do técnico antes de atribuí-lo à equipe")
            if row[1] and row[1] != id_:
                raise Rejected("O técnico já pertence a outra equipe")
        if existing and existing[0] != coach:
            db.execute("UPDATE users SET team_id='' WHERE username=?", (existing[0],))
        db.execute("INSERT INTO teams VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sport=excluded.sport,coach=excluded.coach",
                   (id_, name, sport, coach))
        if coach:
            db.execute("UPDATE users SET team_id=? WHERE username=?", (id_, coach))
        return
    team = text(o, "teamId", 80)
    if not db.execute("SELECT 1 FROM teams WHERE id=?", (team,)).fetchone():
        raise Rejected("Equipe não encontrada", 404)
    if not org and (user[2] != "coach" or user[3] != team):
        raise Rejected("Você só pode modificar o elenco da sua equipe", 403)
    if op == "teamDelete":
        if not org:
            raise Rejected("Apenas a organização pode excluir equipes", 403)
        db.execute("DELETE FROM members WHERE team_id=?", (team,))
        db.execute("UPDATE users SET team_id='' WHERE team_id=?", (team,))
        db.execute("DELETE FROM teams WHERE id=?", (team,))
    elif op == "memberDelete":
        id_ = text(o, "id", 80)
        row = db.execute("SELECT username FROM members WHERE id=? AND team_id=?", (id_, team)).fetchone()
        if not row:
            raise Rejected("Atleta não encontrado no elenco", 404)
        db.execute("DELETE FROM members WHERE id=? AND team_id=?", (id_, team))
        if row[0]:
            db.execute("UPDATE users SET team_id='' WHERE username=? AND team_id=?", (row[0], team))
    elif op == "memberSave":
        id_ = text(o, "id", 80, False) or str(uuid.uuid4())
        name = text(o, "name", 60)
        number, position = text(o, "number", 8, False), text(o, "position", 40, False)
        username = text(o, "username", 40, False).lower()
        old = db.execute("SELECT team_id,username FROM members WHERE id=?", (id_,)).fetchone()
        if old and old[0] != team:
            raise Rejected("Atleta pertence a outra equipe", 403)
        if username:
            row = db.execute("SELECT role,team_id FROM users WHERE username=?", (username,)).fetchone()
            if not row or row[0] != "athlete":
                raise Rejected("Informe uma conta de atleta cadastrada, ou deixe o usuário em branco")
            if row[1] and row[1] != team:
                raise Rejected("A organização precisa transferir este atleta de equipe")
            duplicate = db.execute("SELECT id FROM members WHERE username=? AND id!=?", (username, id_)).fetchone()
            if duplicate:
                raise Rejected("Esta conta de atleta já está no elenco")
            db.execute("UPDATE users SET team_id=? WHERE username=?", (team, username))
        if old and old[1] and old[1] != username:
            db.execute("UPDATE users SET team_id='' WHERE username=? AND team_id=?", (old[1], team))
        db.execute("INSERT INTO members VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,number=excluded.number,position=excluded.position,username=excluded.username",
                   (id_, team, name, number, position, username))
    else:
        raise Rejected("Operação desconhecida")
