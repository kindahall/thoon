import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { getBudHealth } from './bud-backend-client';

type BudProcessStatus = {
  backendRoot: string;
  health: Record<string, unknown> | null;
  managed: boolean;
  ok: boolean;
  pid: number | null;
  running: boolean;
  status: 'online' | 'offline' | 'starting' | 'unhealthy';
};

export async function getBudBackendProcessStatus(): Promise<BudProcessStatus> {
  const pid = readPid();
  const running = pid !== null && isProcessRunning(pid);

  if (!running && pid !== null) {
    removePidFile();
  }

  try {
    const health = await getBudHealth();

    return {
      backendRoot: backendRoot(),
      health,
      managed: running,
      ok: health.status === 'ok',
      pid: running ? pid : null,
      running: true,
      status: health.status === 'ok' ? 'online' : 'unhealthy',
    };
  } catch {
    return {
      backendRoot: backendRoot(),
      health: null,
      managed: running,
      ok: false,
      pid: running ? pid : null,
      running,
      status: running ? 'starting' : 'offline',
    };
  }
}

export async function startBudBackendProcess() {
  const current = await getBudBackendProcessStatus();

  if (current.status === 'online' || current.running) {
    return current;
  }

  const uvicorn = process.env.THOON_BUD_UVICORN_BIN || projectPath('backend', '.venv', 'bin', 'uvicorn');

  if (!existsSync(uvicorn)) {
    throw new Error('Backend Python environment missing. Run npm run backend:venv before starting the integrated backend.');
  }

  mkdirSync(runtimeDir(), { recursive: true });
  const logDescriptor = openSync(logFile(), 'a');
  const child = spawn(uvicorn, ['main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: backendRoot(),
    detached: true,
    env: {
      ...process.env,
      FRONTEND_ORIGINS: process.env.FRONTEND_ORIGINS ?? 'http://localhost:3000,http://localhost:3001',
    },
    stdio: ['ignore', logDescriptor, logDescriptor],
  });

  child.unref();
  writeFileSync(pidFile(), String(child.pid), 'utf8');

  return getBudBackendProcessStatus();
}

export async function stopBudBackendProcess() {
  const pid = readPid();

  if (pid !== null && isProcessRunning(pid)) {
    process.kill(pid, 'SIGTERM');
  }

  removePidFile();

  return getBudBackendProcessStatus();
}

function backendRoot() {
  return projectPath('backend');
}

function runtimeDir() {
  return projectPath('.thoon-data');
}

function pidFile() {
  return projectPath('.thoon-data', 'bud-backend.pid');
}

function logFile() {
  return projectPath('.thoon-data', 'bud-backend.log');
}

function projectPath(...segments: string[]) {
  return resolve(process.env.THOON_PROJECT_ROOT ?? '.', ...segments);
}

function readPid() {
  if (!existsSync(pidFile())) {
    return null;
  }

  const pid = Number(readFileSync(pidFile(), 'utf8'));

  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePidFile() {
  try {
    unlinkSync(pidFile());
  } catch {
    // Missing pid file is already the desired state.
  }
}
