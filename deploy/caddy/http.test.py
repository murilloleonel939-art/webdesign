"""Ejecutar: python3 deploy/caddy/http.test.py /ruta/al/binario/caddy"""
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

binary = str(pathlib.Path(sys.argv[1]).resolve())
source = pathlib.Path(__file__).with_name('Caddyfile')
with tempfile.TemporaryDirectory(prefix='webdesign-caddy-http-') as directory:
    root = pathlib.Path(directory)
    hosts = root / 'hosts'
    hosts.mkdir()
    releases = root / 'site' / 'releases'
    for version in ('v1', 'v2'):
        release = releases / version
        (release / 'assets').mkdir(parents=True)
        (release / 'precios').mkdir()
        (release / 'index.html').write_text(version)
        (release / 'precios' / 'index.html').write_text('precios ' + version)
        (release / 'assets' / 'sample.css').write_text('/* ' + version + ' */')
    public = root / 'site' / 'public'
    public.symlink_to('releases/v1')
    host = hosts / 'demo.example'
    host.symlink_to(public)
    config = json.loads(subprocess.check_output([
        binary, 'adapt', '--config', str(source), '--adapter', 'caddyfile'
    ]))
    config['storage']['root'] = str(root / 'storage')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    config['apps']['http']['servers']['srv0']['listen'] = [f'127.0.0.1:{port}']

    def replace(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if isinstance(item, str):
                    value[key] = item.replace('/data/hosts/', str(hosts) + '/')
                else:
                    replace(item)
        elif isinstance(value, list):
            for item in value:
                replace(item)

    replace(config)
    path = root / 'config.json'
    path.write_text(json.dumps(config))

    def request(pathname, hostname='demo.example'):
        req = urllib.request.Request(f'http://127.0.0.1:{port}{pathname}',
                                     headers={'Host': hostname})
        try:
            response = urllib.request.urlopen(req, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    with (root / 'server.log').open('w') as log:
        proc = subprocess.Popen([binary, 'run', '--config', str(path)],
                                stdout=log, stderr=log)
        try:
            for attempt in range(100):
                if proc.poll() is not None:
                    raise RuntimeError('Caddy terminó antes de aceptar conexiones')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    time.sleep(.02)
            else:
                raise TimeoutError('Caddy no inició')
            for version in ('v1', 'v2', 'v1'):
                temporary = public.with_name('public.next')
                temporary.symlink_to('releases/' + version)
                temporary.replace(public)
                status, body, headers = request('/')
                assert status == 200 and body == version.encode()
                assert headers['X-Content-Type-Options'] == 'nosniff'
                assert request('/precios/')[1] == ('precios ' + version).encode()
                status, body, headers = request('/assets/sample.css')
                assert status == 200 and body == ('/* ' + version + ' */').encode()
                assert 'text/css' in headers['Content-Type']
            missing = request('/', 'missing.example')
            assert missing[0] == 404
            # Solo se retira el enlace de fixture creado por esta prueba.
            assert host.parent == hosts and host.is_symlink()
            host.unlink()
            dark = request('/')
            assert dark[:2] == missing[:2]
            print('OK: HTTP, assets, cambio de release, rollback y apagado')
        finally:
            proc.terminate()
            proc.wait(timeout=5)
