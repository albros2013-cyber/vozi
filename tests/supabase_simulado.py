#!/usr/bin/env python3
"""Servidor de prueba que imita las partes de Supabase que usa VOZI (Auth + REST de vozi_items).
Solo para pruebas automáticas locales. Uso: python3 tests/supabase_simulado.py [puerto]"""
import json, sys, uuid, secrets, threading
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

USUARIOS = {}   # email -> {id, email, password}
TOKENS = {}     # access -> user id
REFRESH = {}    # refresh -> user id
FILAS = {}      # (user_id, store, key) -> fila
LOCK = threading.Lock()
CLAVE = 'sb_publishable_umfmFRom5GJj0MMDPbxItw_Y2jkJyjn'

def ahora():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f') + '+00:00'

def sesion(u):
    a, r = secrets.token_hex(16), secrets.token_hex(16)
    TOKENS[a] = u['id']; REFRESH[r] = u['id']
    return {'access_token': a, 'refresh_token': r, 'expires_in': 3600, 'token_type': 'bearer', 'user': {'id': u['id'], 'email': u['email']}}

def como_jsonb(v):
    # Postgres (jsonb) devuelve las claves reordenadas: primero las más cortas, luego alfabético
    if isinstance(v, dict): return {k: como_jsonb(v[k]) for k in sorted(v, key=lambda k: (len(k.encode()), k))}
    if isinstance(v, list): return [como_jsonb(x) for x in v]
    return v

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'apikey, authorization, content-type, prefer')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    def responder(self, code, obj=None):
        b = b'' if obj is None else json.dumps(obj).encode()
        self.send_response(code); self.cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers()
        self.wfile.write(b)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def cuerpo(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'null') if n else None
    def usuario(self):
        a = (self.headers.get('Authorization') or '').replace('Bearer ', '')
        return TOKENS.get(a)
    def manejar(self, metodo):
        if self.headers.get('apikey') != CLAVE: return self.responder(401, {'message': 'Invalid API key'})
        u = urlparse(self.path); q = parse_qs(u.query); ruta = u.path
        with LOCK:
            if ruta == '/auth/v1/signup' and metodo == 'POST':
                c = self.cuerpo()
                if c['email'] in USUARIOS: return self.responder(422, {'code': 422, 'error_code': 'user_already_exists', 'msg': 'User already registered'})
                if len(c['password']) < 6: return self.responder(422, {'error_code': 'weak_password', 'msg': 'Password should be at least 6 characters'})
                usr = {'id': str(uuid.uuid4()), 'email': c['email'], 'password': c['password']}
                USUARIOS[c['email']] = usr
                return self.responder(200, sesion(usr))
            if ruta == '/auth/v1/token' and metodo == 'POST':
                c = self.cuerpo(); g = q.get('grant_type', [''])[0]
                if g == 'password':
                    usr = USUARIOS.get(c['email'])
                    if not usr or usr['password'] != c['password']: return self.responder(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'error_code': 'invalid_credentials'})
                    return self.responder(200, sesion(usr))
                if g == 'refresh_token':
                    uid = REFRESH.pop(c['refresh_token'], None)
                    usr = next((x for x in USUARIOS.values() if x['id'] == uid), None)
                    if not usr: return self.responder(400, {'error_description': 'Invalid Refresh Token'})
                    return self.responder(200, sesion(usr))
            if ruta == '/auth/v1/user':
                uid = self.usuario()
                usr = next((x for x in USUARIOS.values() if x['id'] == uid), None)
                if not usr: return self.responder(401, {'msg': 'invalid JWT'})
                if metodo == 'PUT': usr['password'] = self.cuerpo()['password']
                return self.responder(200, {'id': usr['id'], 'email': usr['email']})
            if ruta == '/auth/v1/logout': return self.responder(204)
            if ruta == '/auth/v1/recover': return self.responder(200, {})
            if ruta == '/rest/v1/vozi_items':
                uid = self.usuario()
                if not uid: return self.responder(401, {'message': 'JWT expired'})
                if metodo == 'POST':
                    for f in self.cuerpo():
                        if f.get('user_id', uid) != uid: return self.responder(403, {'message': 'new row violates row-level security policy'})
                        FILAS[(uid, f['store'], f['key'])] = {'user_id': uid, 'store': f['store'], 'key': f['key'], 'data': como_jsonb(f.get('data')), 'deleted': bool(f.get('deleted')), 'updated_at': ahora()}
                    return self.responder(201)
                if metodo == 'GET':
                    filas = [f for (u2, _, _), f in FILAS.items() if u2 == uid]
                    for k, v in q.items():
                        if k == 'updated_at' and v[0].startswith('gte.'):
                            desde = unquote(v[0][4:]).replace('Z', '+00:00')
                            filas = [f for f in filas if datetime.fromisoformat(f['updated_at']) >= datetime.fromisoformat(desde)]
                    filas.sort(key=lambda f: f['updated_at'])
                    off = int(q.get('offset', ['0'])[0]); lim = int(q.get('limit', ['1000'])[0])
                    return self.responder(200, [{k: f[k] for k in ('store', 'key', 'data', 'deleted', 'updated_at')} for f in filas[off:off + lim]])
        return self.responder(404, {'message': 'no encontrado'})
    def do_GET(self): self.manejar('GET')
    def do_POST(self): self.manejar('POST')
    def do_PUT(self): self.manejar('PUT')

if __name__ == '__main__':
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    ThreadingHTTPServer(('127.0.0.1', puerto), H).serve_forever()
