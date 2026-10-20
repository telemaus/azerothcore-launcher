const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { loadConfig, saveConfig, defaultConfig } = require('./config');

let mainWindow;
let pathSettingsWindow;
const processes = {};
const serviceStatus = { db: 'Stopped', auth: 'Stopped', world: 'Stopped' };
const serviceChecksInProgress = new Map();
let config = defaultConfig;
const PATH_OPTIONS = {
  db: { label: 'MySQL server or start script', extensions: ['bat', 'exe'] },
  auth: { label: 'Auth server', extensions: ['exe'] },
  world: { label: 'World server', extensions: ['exe'] },
  client: { label: 'WoW client (optional)', extensions: ['exe'], optional: true }
};

const SERVICES = {
  db: { port: 3307, timeout: 120000, configName: 'my.ini', portKey: 'port' },
  auth: { port: 3724, timeout: 90000, configName: path.join('configs', 'authserver.conf'), portKey: 'RealmServerPort' },
  world: { port: 8085, timeout: 240000, configName: path.join('configs', 'worldserver.conf'), portKey: 'WorldServerPort' }
};
const SERVICE_NAMES = Object.keys(SERVICES);
const SERVICE_POLL_INTERVAL = 1500;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 440,
    title: 'Azerothcore Launcher',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    resizable: false,
    maximizable: false,
    backgroundColor: '#fafafa',
  });

  mainWindow.setMenu(null);
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Load configuration after window is ready
  const savedConfig = loadConfig();
  config = {
    ...defaultConfig,
    ...(savedConfig && typeof savedConfig === 'object' ? savedConfig : {}),
    paths: {
      ...defaultConfig.paths,
      ...(savedConfig && savedConfig.paths && typeof savedConfig.paths === 'object' ? savedConfig.paths : {})
    }
  };
  console.log('Configuration loaded:', config);
  if (!config.isConfigured) {
    await openPathSettings();
  }
  startServiceMonitoring();
}

function openPathSettings() {
  if (pathSettingsWindow && !pathSettingsWindow.isDestroyed()) {
    pathSettingsWindow.focus();
    return Promise.resolve();
  }

  pathSettingsWindow = new BrowserWindow({
    width: 900,
    height: 390,
    minWidth: 760,
    minHeight: 360,
    parent: mainWindow,
    modal: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#f8fafc'
  });

  pathSettingsWindow.setMenu(null);
  pathSettingsWindow.on('closed', () => {
    pathSettingsWindow = null;
    if (!config.isConfigured) {
      app.quit();
    }
  });

  return pathSettingsWindow.loadFile(path.join(__dirname, 'path-settings.html'));
}

ipcMain.handle('open-path-settings', async () => {
  await openPathSettings();
  return true;
});

ipcMain.handle('get-config-paths', () => ({ ...config.paths }));

ipcMain.handle('select-config-path', async (_event, name) => {
  const option = PATH_OPTIONS[name];
  if (!option) {
    throw new Error(`Unknown path setting: ${name}`);
  }

  const result = await dialog.showOpenDialog(pathSettingsWindow, {
    title: `Select ${option.label}`,
    filters: [{ name: option.label, extensions: option.extensions }],
    properties: ['openFile']
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('reveal-config-path', async (_event, value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return 'No path is configured for this item.';
  }

  const target = path.resolve(value);
  try {
    if (!fs.statSync(target).isFile()) {
      return `The configured path is not a file: ${target}`;
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES') {
      return `The configured path does not exist: ${target}`;
    }
    throw error;
  }

  shell.showItemInFolder(target);
  return null;
});

ipcMain.handle('save-config-paths', (_event, paths) => {
  if (!paths || typeof paths !== 'object') {
    return { success: false, error: 'Invalid path settings.' };
  }

  const validatedPaths = {};
  for (const [name, option] of Object.entries(PATH_OPTIONS)) {
    const value = typeof paths[name] === 'string' ? paths[name].trim() : '';
    if (option.optional && !value) {
      validatedPaths[name] = '';
      continue;
    }

    if (!value) {
      return { success: false, error: `${option.label} is required.` };
    }

    const selectedPath = path.resolve(value);
    let isFile = false;
    try {
      isFile = fs.statSync(selectedPath).isFile();
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && error.code !== 'EACCES') {
        throw error;
      }
    }
    if (!isFile) {
      return { success: false, error: `${option.label} file was not found: ${selectedPath}` };
    }

    if (!option.extensions.includes(path.extname(selectedPath).slice(1).toLowerCase())) {
      return { success: false, error: `${option.label} must be a .${option.extensions.join(' or .')} file.` };
    }

    validatedPaths[name] = selectedPath;
  }

  const previousConfig = config;
  config = {
    ...config,
    paths: validatedPaths,
    isConfigured: true
  };
  if (!saveConfig(config)) {
    config = previousConfig;
    return { success: false, error: 'Could not save the path settings.' };
  }

  if (pathSettingsWindow && !pathSettingsWindow.isDestroyed()) {
    pathSettingsWindow.close();
  }
  return { success: true };
});

ipcMain.handle('close-path-settings', () => {
  if (config.isConfigured) {
    if (pathSettingsWindow && !pathSettingsWindow.isDestroyed()) {
      pathSettingsWindow.close();
    }
  } else {
    app.quit();
  }
});

function findConfigFile(directory, configName) {
  let currentDirectory = directory;
  for (let level = 0; level < 5; level += 1) {
    const candidate = path.join(currentDirectory, configName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }
  return null;
}

function readConfiguredPort(configPath, portKey, fallbackPort) {
  if (!configPath) {
    return fallbackPort;
  }
  try {
    const configText = fs.readFileSync(configPath, 'utf8');
    const escapedKey = portKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = configText.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(\\d+)`, 'im'));
    return match ? Number(match[1]) : fallbackPort;
  } catch (error) {
    console.warn(`Could not read service config ${configPath}:`, error.message);
    return fallbackPort;
  }
}

function resolveService(name) {
  const service = SERVICES[name];
  const configuredPath = config.paths[name];
  if (!service || !configuredPath) {
    return null;
  }

  let command = configuredPath;
  let args = [];
  let configPath = findConfigFile(path.dirname(configuredPath), service.configName);

  if (name === 'db') {
    if (path.extname(configuredPath).toLowerCase() === '.bat') {
      const serverDirectory = path.dirname(configuredPath);
      const mysqlExecutable = path.join(serverDirectory, 'mysql', 'bin', 'mysqld.exe');
      const mysqlConfig = path.join(serverDirectory, 'my.ini');
      if (fs.existsSync(mysqlExecutable) && fs.existsSync(mysqlConfig)) {
        command = mysqlExecutable;
        args = [`--defaults-file=${mysqlConfig}`];
        configPath = mysqlConfig;
      }
    } else {
      configPath = findConfigFile(path.dirname(configuredPath), service.configName);
      if (configPath) {
        args = [`--defaults-file=${configPath}`];
      }
    }
  }

  return {
    command,
    args,
    port: readConfiguredPort(configPath, service.portKey, service.port)
  };
}

function isPortReady(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (ready) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function setServiceStatus(name, status) {
  if (serviceStatus[name] === status) {
    return;
  }
  serviceStatus[name] = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process-status', name, status);
  }
}

async function updateServiceStatus(name) {
  const existingCheck = serviceChecksInProgress.get(name);
  if (existingCheck) {
    return existingCheck;
  }

  const check = (async () => {
    const service = resolveService(name);
    const ready = service ? await isPortReady(service.port) : false;
    const processIsStarting = Boolean(
      processes[name] && processes[name].exitCode === null && processes[name].signalCode === null
    );
    setServiceStatus(name, ready ? 'Running' : processIsStarting ? 'Starting' : 'Stopped');
    return ready;
  })();
  serviceChecksInProgress.set(name, check);
  try {
    return await check;
  } finally {
    if (serviceChecksInProgress.get(name) === check) {
      serviceChecksInProgress.delete(name);
    }
  }
}

function startServiceMonitoring() {
  for (const name of SERVICE_NAMES) {
    void updateServiceStatus(name);
  }
  setInterval(() => {
    for (const name of SERVICE_NAMES) {
      void updateServiceStatus(name);
    }
  }, SERVICE_POLL_INTERVAL);
}

async function waitForServiceReady(name) {
  const deadline = Date.now() + SERVICES[name].timeout;
  while (Date.now() < deadline) {
    if (await updateServiceStatus(name)) {
      return true;
    }
    if (!processes[name]) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return updateServiceStatus(name);
}

function launchProcess(name, command, args = []) {
  if (processes[name]) {
    return false;
  }

  console.log(`Launching ${name} with command: ${command}`);
  try {
    const isBatchFile = path.extname(command).toLowerCase() === '.bat';
    const proc = spawn(command, args, {
      detached: false,
      shell: isBatchFile && process.platform === 'win32',
      windowsHide: process.platform === 'win32' && name === 'db',
      cwd: path.dirname(command)
    });

    proc.stdout.on('data', (data) => {
      console.log(`${name} stdout: ${data}`);
      mainWindow.webContents.send('process-log', name, 'output', data.toString());
    });

    proc.stderr.on('data', (data) => {
      console.error(`${name} stderr: ${data}`);
      mainWindow.webContents.send('process-log', name, 'error', data.toString());
    });

    proc.on('error', (error) => {
      console.error(`${name} failed to start:`, error);
      mainWindow.webContents.send('process-log', name, 'error', `Failed to start: ${error.message}`);
      processes[name] = null;
      if (SERVICE_NAMES.includes(name)) {
        void updateServiceStatus(name);
      } else {
        mainWindow.webContents.send('process-status', name, 'Error');
      }
    });

    proc.on('exit', (code, signal) => {
      console.log(`${name} exited with code ${code} and signal ${signal}`);
      processes[name] = null;
      mainWindow.webContents.send('process-log', name, 'info', `Process exited with code ${code}`);
      if (SERVICE_NAMES.includes(name)) {
        void updateServiceStatus(name);
      } else {
        mainWindow.webContents.send('process-status', name, 'Stopped');
      }
    });

    processes[name] = proc;
    if (SERVICE_NAMES.includes(name)) {
      setServiceStatus(name, 'Starting');
    } else {
      mainWindow.webContents.send('process-status', name, 'Running');
    }
    return true;
  } catch (error) {
    console.error(`Error launching ${name}:`, error);
    mainWindow.webContents.send('process-log', name, 'error', `Launch error: ${error.message}`);
    return false;
  }
}

async function startService(name, waitUntilReady = false) {
  const service = resolveService(name);
  if (!service) {
    console.error(`No executable is configured for ${name}.`);
    setServiceStatus(name, 'Stopped');
    return false;
  }

  if (await isPortReady(service.port)) {
    setServiceStatus(name, 'Running');
    return true;
  }

  if (!processes[name] && !launchProcess(name, service.command, service.args)) {
    return false;
  }

  setServiceStatus(name, 'Starting');
  return waitUntilReady ? waitForServiceReady(name) : true;
}

async function stopProcess(name) {
  const proc = processes[name];
  if (!proc) {
    if (SERVICE_NAMES.includes(name)) {
      await updateServiceStatus(name);
      return serviceStatus[name] === 'Stopped';
    }
    return true;
  }

  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
      await new Promise((resolve, reject) => {
        killer.once('error', reject);
        killer.once('exit', (code) => code === 0
          ? resolve()
          : reject(new Error(`taskkill exited with code ${code}`)));
      });
    } else {
      proc.kill('SIGTERM');
    }

    await new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      proc.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
    if (processes[name] === proc) {
      processes[name] = null;
    }
    if (SERVICE_NAMES.includes(name)) {
      await updateServiceStatus(name);
      return serviceStatus[name] === 'Stopped';
    }
    mainWindow.webContents.send('process-status', name, 'Stopped');
    return true;
  } catch (error) {
    console.error(`Error stopping ${name}:`, error);
    return false;
  }
}

async function restartProcess(name, command, args = []) {
  if (SERVICE_NAMES.includes(name) && !await stopProcess(name)) {
    return false;
  }
  if (processes[name] && !await stopProcess(name)) {
    return false;
  }
  if (SERVICE_NAMES.includes(name)) {
    return startService(name);
  }
  return launchProcess(name, command, args);
}

// IPC handlers for UI commands
ipcMain.handle('launch', async (event, name) => {
  if (SERVICE_NAMES.includes(name)) {
    return startService(name);
  }
  return launchProcess(name, config.paths[name]);
});

ipcMain.handle('restart', async (event, name) => {
  switch (name) {
    case 'db':
      return await restartProcess('db', config.paths.db);
    case 'auth':
      return await restartProcess('auth', config.paths.auth);
    case 'world':
      return await restartProcess('world', config.paths.world);
    default:
      return false;
  }
});

// Add configuration related IPC handlers
ipcMain.handle('reconfigure', async () => {
  await openPathSettings();
  return true;
});

// Handle starting all servers and client
ipcMain.handle('start-all', async () => {
  try {
    for (const serverName of SERVICE_NAMES) {
      const ready = await startService(serverName, true);
      if (!ready) {
        console.error(`${serverName} did not become ready before the startup timeout.`);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error('Error in start-all:', error);
    return false;
  }
});

// Handle individual process stop
ipcMain.handle('stop', async (event, name) => {
  return stopProcess(name);
});

// Handle graceful shutdown of all servers
ipcMain.handle('stop-all', async () => {
  const results = [];
  for (const name of ['world', 'auth', 'db']) {
    results.push(await stopProcess(name));
  }
  return results.every(Boolean);
});

ipcMain.handle('get-service-statuses', async () => {
  await Promise.all(SERVICE_NAMES.map(updateServiceStatus));
  return { ...serviceStatus };
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Restart only services managed by this launcher, then wait for actual readiness.
ipcMain.handle('restart-all', async () => {
  try {
    for (const name of ['world', 'auth', 'db']) {
      if (!await stopProcess(name)) {
        return false;
      }
    }
    for (const name of SERVICE_NAMES) {
      if (!await startService(name, true)) {
        console.error(`${name} did not become ready before the startup timeout.`);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error('Error in restart-all:', error);
    return false;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
