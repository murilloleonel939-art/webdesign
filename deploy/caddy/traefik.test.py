"""Prueba aislada: python3 deploy/caddy/traefik.test.py /ruta/traefik"""
import http.server
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Backend(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.server.marker)

    def log_message(self, *args):
        pass


servers = []
try:
    for marker in (b'existing-app', b'site-backend'):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        server.marker = marker
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
    with tempfile.TemporaryDirectory(prefix='webdesign-traefik-') as directory:
        root = pathlib.Path(directory)
        entry = port()
        services = {name: {'loadBalancer': {'servers': [
            {'url': f'http://127.0.0.1:{server.server_port}'}]}}
            for name, server in zip(('existing', 'sites'), servers)}
        routers = {'existing': {'rule': 'Host(`existing.example`)',
                               'service': 'existing'}}
        dynamic = root / 'routes.json'

        def save():
            temporary = root / 'routes.tmp'
            temporary.write_text(json.dumps({'http': {
                'routers': routers, 'services': services}}))
            temporary.replace(dynamic)

        def request(host):
            req = urllib.request.Request(f'http://127.0.0.1:{entry}/',
                                         headers={'Host': host})
            try:
                response = urllib.request.urlopen(req, timeout=2)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, response.read()

        save()
        with (root / 'traefik.log').open('w') as log:
            proc = subprocess.Popen([str(pathlib.Path(sys.argv[1]).resolve()),
                f'--entrypoints.web.address=127.0.0.1:{entry}',
                f'--providers.file.filename={dynamic}',
                '--providers.file.watch=true', '--providers.providersThrottleDuration=100ms',
                '--global.checknewversion=false', '--global.sendanonymoususage=false'],
                stdout=log, stderr=log)
            try:
                for attempt in range(100):
                    try:
                        if request('existing.example') == (200, b'existing-app'):
                            break
                    except OSError:
                        pass
                    time.sleep(.05)
                else:
                    raise AssertionError('No se cargó el router existente')
                assert request('new.example')[0] == 404
                routers['sites'] = {'rule': 'PathPrefix(`/`)', 'priority': 1,
                                    'service': 'sites'}
                save()
                for attempt in range(100):
                    if request('new.example') == (200, b'site-backend'):
                        break
                    time.sleep(.05)
                else:
                    raise AssertionError('No se cargó el router de prioridad 1')
                assert request('existing.example') == (200, b'existing-app')
                print('OK: proveedor dinámico y prioridad 1 conservan el router existente')
            finally:
                proc.terminate()
                proc.wait(timeout=5)
finally:
    for server in servers:
        server.shutdown()
        server.server_close()
