from http.server import BaseHTTPRequestHandler
import json, os, requests

WEBDAV_URL = os.environ.get('WEBDAV_URL', 'https://dav.jianguoyun.com/dav')
WEBDAV_USER = os.environ.get('WEBDAV_USER', '')
WEBDAV_PASS = os.environ.get('WEBDAV_PASS', '')
FOLDER = '/待办助手'

def wd_get(fname):
    r = requests.get(f"{WEBDAV_URL}{FOLDER}/{fname}", auth=(WEBDAV_USER, WEBDAV_PASS), timeout=15)
    if r.status_code == 200:
        return r.json()
    return None

def wd_put(fname, data):
    try:
        requests.request('MKCOL', f"{WEBDAV_URL}{FOLDER}/", auth=(WEBDAV_USER, WEBDAV_PASS), timeout=10)
    except: pass
    r = requests.put(f"{WEBDAV_URL}{FOLDER}/{fname}", json=data, auth=(WEBDAV_USER, WEBDAV_PASS), timeout=15)
    return r.status_code in (200, 201, 204)

def load_data():
    tasks = wd_get('todos.json') or []
    lists = wd_get('lists.json') or []
    habits = wd_get('habits.json') or []
    return tasks, lists, habits

def save_data(tasks=None, lists=None, habits=None):
    if tasks is not None: wd_put('todos.json', tasks)
    if lists is not None: wd_put('lists.json', lists)
    if habits is not None: wd_put('habits.json', habits)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path
        if path == '/api/tasks':
            tasks, _, _ = load_data()
            self._send(tasks)
        elif path == '/api/lists':
            _, lists, _ = load_data()
            self._send(lists)
        elif path == '/api/habits':
            _, _, habits = load_data()
            self._send(habits)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        if self.path == '/api/tasks':
            tasks, _, _ = load_data()
            body['id'] = max([x.get('id',0) for x in tasks] + [0]) + 1
            tasks.insert(0, body)
            save_data(tasks=tasks)
            self._send(body)
        elif self.path == '/api/lists':
            _, lists, _ = load_data()
            body['id'] = 'l' + str(len(lists) + 1)
            lists.append(body)
            save_data(lists=lists)
            self._send(body)
        elif self.path == '/api/habits':
            _, _, habits = load_data()
            body['id'] = max([x.get('id',0) for x in habits] + [0]) + 1
            habits.append(body)
            save_data(habits=habits)
            self._send(body)

    def do_PUT(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        parts = self.path.split('/')
        tid = int(parts[-1])
        if parts[2] == 'tasks':
            tasks, _, _ = load_data()
            for i, x in enumerate(tasks):
                if x['id'] == tid:
                    tasks[i] = {**x, **body}
                    break
            save_data(tasks=tasks)
            self._send(body)
        elif parts[2] == 'habits':
            _, _, habits = load_data()
            for i, x in enumerate(habits):
                if x['id'] == tid:
                    habits[i] = {**x, **body}
                    break
            save_data(habits=habits)
            self._send(body)

    def do_DELETE(self):
        parts = self.path.split('/')
        tid = int(parts[-1])
        if parts[2] == 'tasks':
            tasks, _, _ = load_data()
            tasks = [x for x in tasks if x['id'] != tid]
            save_data(tasks=tasks)
        self._send({'ok': True})

    def _send(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
