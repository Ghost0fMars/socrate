import { app, BrowserWindow, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';

const isDev = process.env.ELECTRON_DEV === 'true';
let backendProcess: ChildProcess | null = null;
let ollamaProcess: ChildProcess | null = null;

function getOllamaExecutable(): string {
  if (process.env.OLLAMA_PATH) return process.env.OLLAMA_PATH;

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.LOCALAPPDATA ?? '',
            'Programs',
            'Ollama',
            'ollama.exe'
          ),
          path.join(process.env.PROGRAMFILES ?? '', 'Ollama', 'ollama.exe'),
          'ollama.exe',
        ]
      : ['ollama'];

  return candidates.find((candidate) => {
    if (candidate === 'ollama' || candidate === 'ollama.exe') return true;
    return fs.existsSync(candidate);
  }) ?? candidates[0];
}

function waitForOllama(retries = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get('http://localhost:11434/api/tags', (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(1000);
      req.on('error', () => {
        if (++attempts >= retries) {
          reject(new Error("Ollama n'a pas démarré dans les temps."));
        } else {
          setTimeout(check, 1000);
        }
      });
      req.end();
    };
    check();
  });
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    await waitForOllama(1);
    return true;
  } catch {
    return false;
  }
}

function startOllama() {
  const executable = getOllamaExecutable();
  ollamaProcess = spawn(executable, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
  });

  ollamaProcess.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[ollama] ${d}`)
  );
  ollamaProcess.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[ollama] ${d}`)
  );
  ollamaProcess.on('exit', (code) => {
    console.log(`[ollama] exited with code ${code}`);
    ollamaProcess = null;
  });
}

function waitForBackend(retries = 40): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get('http://localhost:8000/docs', (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(1500);
      req.on('error', () => {
        if (++attempts >= retries) {
          reject(new Error("Le backend Python n'a pas démarré dans les temps."));
        } else {
          setTimeout(check, 1500);
        }
      });
      req.end();
    };
    setTimeout(check, 2000);
  });
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/docs`, (res) => {
      res.resume();
      resolve(true);
    });
    req.setTimeout(1000);
    req.on('error', () => resolve(false));
    req.end();
  });
}

function startBackend() {
  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(app.getAppPath(), 'server');

  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'cmd' : 'bash';
  const args = isWindows ? ['/c', 'call', 'start.bat'] : ['start.sh'];

  backendProcess = spawn(command, args, {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  backendProcess.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[backend] ${d}`)
  );
  backendProcess.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[backend] ${d}`)
  );
  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Socrate',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  if (!(await isOllamaRunning())) {
    startOllama();
    try {
      await waitForOllama();
    } catch (e) {
      console.error(e);
    }
  }

  if (!(await isPortInUse(8000))) {
    startBackend();
  }
  try {
    await waitForBackend();
  } catch (e) {
    console.error(e);
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  backendProcess?.kill('SIGTERM');
  ollamaProcess?.kill('SIGTERM');
  if (process.platform !== 'darwin') app.quit();
});
