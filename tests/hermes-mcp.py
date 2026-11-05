"""Native MCP smoke test with an isolated application identity and synthetic data.
Build with tests/hermes-mcp.config.json and pass the full executable path.
Never installs the program or writes to the Windows clipboard.
"""
import base64
import json
import os
from pathlib import Path
import queue
import struct
import subprocess
import sys
import threading
import time
import zlib

IDENTIFIER = 'com.tigerhzu.clarityclipboard.hermes-mcp-test'
exe = Path(sys.argv[1]).resolve()
assert IDENTIFIER.encode() in exe.read_bytes(), 'Build the isolated test executable first'
data = Path(os.environ['APPDATA']) / IDENTIFIER
assert not data.exists(), 'Existing test data must be inspected before running this test'
data.mkdir()
settings = {'retentionDays': 7, 'textScale': 100, 'hotkey': 'Ctrl+Alt+Shift+F11',
            'sensitiveFilterEnabled': True, 'excludedApps': [], 'hermesEnabled': True}
# Avoid recording ambient clipboard activity while the hidden test application runs.
processes = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command',
    '(Get-Process | Select-Object -ExpandProperty ProcessName -Unique) -join "`n"'], text=True)
settings['excludedApps'] = [name + '.exe' for name in processes.splitlines() if name]
settings_path = data / 'settings.json'
settings_path.write_text(json.dumps(settings), encoding='utf-8')
clients = []
app = None

class Client:
    def __init__(self):
        self.process = subprocess.Popen([str(exe), '--mcp'], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
            creationflags=subprocess.CREATE_NO_WINDOW)
        self.responses = queue.Queue()
        self.next_id = 0
        def read():
            for line in self.process.stdout:
                self.responses.put(line)
            self.responses.put(None)
        threading.Thread(target=read, daemon=True).start()
        clients.append(self)
    def request(self, method, params=None):
        self.next_id += 1
        request = {'jsonrpc': '2.0', 'id': self.next_id, 'method': method}
        if params is not None:
            request['params'] = params
        self.process.stdin.write(json.dumps(request, ensure_ascii=False) + '\n')
        self.process.stdin.flush()
        line = self.responses.get(timeout=25)
        assert line is not None, 'MCP subprocess exited unexpectedly'
        result = json.loads(line)
        assert result['id'] == self.next_id, result
        return result
    def call(self, tool_name, **arguments):
        result = self.request('tools/call', {'name': tool_name, 'arguments': arguments})
        assert 'error' not in result, result
        assert not result['result'].get('isError'), result
        return result['result']
    def value(self, tool_name, **arguments):
        return json.loads(self.call(tool_name, **arguments)['content'][0]['text'])

def start():
    global app
    app = subprocess.Popen([str(exe)], creationflags=subprocess.CREATE_NO_WINDOW)
    deadline = time.monotonic() + 35
    descriptor = data / 'hermes-bridge.json'
    while time.monotonic() < deadline:
        assert app.poll() is None, 'Test application exited before initialization'
        if descriptor.exists():
            try:
                json.loads(descriptor.read_text(encoding='utf-8'))
                return
            except (ValueError, OSError):
                pass
        time.sleep(0.1)
    raise RuntimeError('Test bridge did not initialize')

def stop():
    global app
    if app is not None and app.poll() is None:
        app.terminate()
        app.wait(timeout=10)
    app = None

def png():
    def chunk(name, content):
        return struct.pack('>I', len(content)) + name + content + struct.pack('>I', zlib.crc32(name + content))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\xff\x00\xff\x00\xff')) + chunk(b'IEND', b'')

try:
    client = Client()
    offline = client.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
        'clientInfo': {'name': 'isolated-native-test', 'version': '1'}})
    assert offline['error']['code'] == -32000
    start()
    init = client.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
        'clientInfo': {'name': 'isolated-native-test', 'version': '1'}})
    assert init['result']['protocolVersion'] == '2025-06-18'
    client.process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    client.process.stdin.flush()
    assert len(client.request('tools/list')['result']['tools']) == 9
    status = client.value('clarity_status')
    assert status['connected'] is True
    assert status['version'] == '1.0.14'
    print('PASS native stdio initialize, notifications, tools/list, status and offline recovery', flush=True)
    folder = client.value('clarity_create_folder', name='Native MCP test')
    for storage in ['history', 'personal', 'folder']:
        item = client.value('clarity_save_item', storage=storage, folderId=folder['id'], title='中文 native 🐯', content='合成測試 ' + storage)
        result = client.value('clarity_search', storage=storage, folderId=folder['id'], query='中文 native')
        assert result['total'] == 1
        assert client.value('clarity_get_item', storage=storage, id=item['id'])['content'] == '合成測試 ' + storage
        client.value('clarity_save_item', storage=storage, id=item['id'], title='Edited', content='更新後的內容')
        assert client.value('clarity_get_item', storage=storage, id=item['id'])['content'] == '更新後的內容'
        assert client.value('clarity_delete_item', storage=storage, id=item['id'])['deleted'] is True
    image = client.value('clarity_save_item', title='Synthetic PNG', contentType='IMAGE', imageBase64=base64.b64encode(png()).decode())
    block = client.call('clarity_get_image', storage='personal', id=image['id'], thumbnail=False)['content'][0]
    assert block['mimeType'] == 'image/png'
    assert base64.b64decode(block['data']).startswith(b'\x89PNG')
    client.value('clarity_delete_item', storage='personal', id=image['id'])
    bad = client.request('tools/call', {'name': 'clarity_search', 'arguments': {'limit': 101}})
    assert bad['error']['code'] == -32602
    print('PASS native text/image create, search, read, edit, delete and invalid argument rejection', flush=True)
    stop()
    settings['hermesEnabled'] = False
    settings_path.write_text(json.dumps(settings), encoding='utf-8')
    # Remove only this test's stale descriptor so start() waits for a new one.
    (data / 'hermes-bridge.json').unlink(missing_ok=True)
    start()
    denied = client.request('tools/call', {'name': 'clarity_status', 'arguments': {}})
    assert denied['error']['code'] == -32001
    print('PASS native restart discovery and disabled access rejection', flush=True)
finally:
    for client in clients:
        if client.process.poll() is None:
            client.process.stdin.close()
            try:
                client.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                client.process.terminate()
                client.process.wait(timeout=5)
    stop()
    print('Isolated synthetic test data retained at ' + str(data), flush=True)
