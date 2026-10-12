"""待办助手云端版：Flask API + 静态前端，数据自动同步坚果云 WebDAV。"""
import os, json, logging, requests
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='static', static_url_path='/static')
logging.basicConfig(level=logging.INFO)

# 坚果云配置（从环境变量读，不写死）
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
    # 先建目录
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

# 首页
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

# 任务 API
@app.get('/api/tasks')
def get_tasks():
    tasks, _, _ = load_data()
    return jsonify(tasks)

@app.post('/api/tasks')
def add_task():
    t = request.json
    tasks, _, _ = load_data()
    t['id'] = max([x.get('id',0) for x in tasks] + [0]) + 1
    tasks.insert(0, t)
    save_data(tasks=tasks)
    return jsonify(t)

@app.put('/api/tasks/<int:tid>')
def update_task(tid):
    t = request.json
    tasks, _, _ = load_data()
    for i, x in enumerate(tasks):
        if x['id'] == tid:
            tasks[i] = {**x, **t}
            break
    save_data(tasks=tasks)
    return jsonify(t)

@app.delete('/api/tasks/<int:tid>')
def del_task(tid):
    tasks, _, _ = load_data()
    tasks = [x for x in tasks if x['id'] != tid]
    save_data(tasks=tasks)
    return jsonify({'ok': True})

# 清单 API
@app.get('/api/lists')
def get_lists():
    _, lists, _ = load_data()
    return jsonify(lists)

@app.post('/api/lists')
def add_list():
    l = request.json
    _, lists, _ = load_data()
    l['id'] = 'l' + str(len(lists) + 1)
    lists.append(l)
    save_data(lists=lists)
    return jsonify(l)

# 习惯 API
@app.get('/api/habits')
def get_habits():
    _, _, habits = load_data()
    return jsonify(habits)

@app.post('/api/habits')
def add_habit():
    h = request.json
    _, _, habits = load_data()
    h['id'] = max([x.get('id',0) for x in habits] + [0]) + 1
    habits.append(h)
    save_data(habits=habits)
    return jsonify(h)

@app.put('/api/habits/<int:hid>')
def update_habit(hid):
    h = request.json
    _, _, habits = load_data()
    for i, x in enumerate(habits):
        if x['id'] == hid:
            habits[i] = {**x, **h}
            break
    save_data(habits=habits)
    return jsonify(h)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
