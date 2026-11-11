// Supervises the site's Astro dev server (and one-off builds) as a child process.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'astro-runner.mjs');
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

async function freePort(start) {
  for (let p = start; p < start + 200; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('No free port found');
}

export class DevServer {
  constructor(root, emit) {
    this.root = root;
    this.emit = emit;
    this.status = 'stopped';
    this.port = null;
    this.logs = [];
    this.child = null;
    this.building = false;
  }
  get url() {
    return this.port ? `http://localhost:${this.port}` : null;
  }
  info() {
    return { status: this.status, url: this.url, building: this.building };
  }
  log(line, stream = 'out', source = 'dev') {
    for (const raw of String(line).split(/\r?\n/)) {
      const text = strip(raw);
      if (!text.trim() || text.startsWith('__ASTROLABE_')) continue;
      const entry = { t: Date.now(), text, stream, source };
      this.logs.push(entry);
      if (this.logs.length > 600) this.logs.shift();
      this.emit({ type: 'log', entry });
    }
  }
  setStatus(s) {
    this.status = s;
    this.emit({ type: 'dev', dev: this.info() });
  }
  async start() {
    if (this.child) return;
    const port = await freePort(Number(process.env.ASTROLABE_SITE_PORT) || 4601);
    this.setStatus('starting');
    const child = spawn(process.execPath, [runner, 'dev', String(port)], { cwd: this.root, env: { ...process.env, FORCE_COLOR: '0', ASTRO_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.child = child;
    child.stdout.on('data', (d) => {
      const s = String(d);
      const m = /__ASTROLABE_READY__ (\d+)/.exec(s);
      if (m) {
        this.port = Number(m[1]);
        this.setStatus('running');
      }
      this.log(s);
    });
    child.stderr.on('data', (d) => this.log(String(d), 'err'));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.port = null;
      this.setStatus(code ? 'error' : 'stopped');
      if (code) this.log(`Astro dev server exited with code ${code}`, 'err');
    });
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    await new Promise((res) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        res();
      }, 4000);
      child.once('exit', () => {
        clearTimeout(t);
        res();
      });
      child.kill('SIGTERM');
    });
    this.port = null;
    this.setStatus('stopped');
  }
  async restart() {
    await this.stop();
    await this.start();
  }
  build() {
    if (this.building) return Promise.resolve({ ok: false, message: 'A build is already running.' });
    this.building = true;
    this.emit({ type: 'dev', dev: this.info() });
    this.log('▶ astro build', 'out', 'build');
    const started = Date.now();
    return new Promise((res) => {
      const child = spawn(process.execPath, [runner, 'build'], { cwd: this.root, env: { ...process.env, FORCE_COLOR: '0', ASTRO_TELEMETRY_DISABLED: '1' } });
      child.stdout.on('data', (d) => this.log(String(d), 'out', 'build'));
      child.stderr.on('data', (d) => this.log(String(d), 'err', 'build'));
      child.on('exit', (code) => {
        this.building = false;
        const ok = code === 0;
        this.log(ok ? `✔ Build finished in ${((Date.now() - started) / 1000).toFixed(1)}s — output is in dist/` : `✖ Build failed (exit code ${code})`, ok ? 'out' : 'err', 'build');
        this.emit({ type: 'dev', dev: this.info() });
        res({ ok, seconds: (Date.now() - started) / 1000 });
      });
    });
  }
}
