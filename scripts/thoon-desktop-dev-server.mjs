import { spawn } from 'node:child_process';

const port = process.env.THOON_DESKTOP_PORT ?? '3001';
const url = process.env.THOON_DESKTOP_DEV_URL ?? `http://127.0.0.1:${port}`;

if (await isReady(url)) {
  console.log(`Thoon dev server already running at ${url}.`);
  keepAlive();
} else {
  const child = spawn('npm', ['run', 'dev', '--', '-p', port], {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  const shutdown = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

async function isReady(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(targetUrl, { signal: controller.signal });

    return response.ok || response.status === 401 || response.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function keepAlive() {
  setInterval(() => undefined, 24 * 60 * 60 * 1000);
}
