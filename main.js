const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, defaultConfig } = require('./config');

let mainWindow;
let pathSettingsWindow;
const processes = {};
let config = defaultConfig;
const PATH_OPTIONS = {
  db: { label: 'MySQL start script', extensions: ['bat'] },
  auth: { label: 'Auth server', extensions: ['exe'] },
  world: { label: 'World server', extensions: ['exe'] },
  client: { label: 'WoW client (optional)', extensions: ['exe'], optional: true }
};

// Centralized delay configurations
const SERVER_DELAYS = {
  db: 5000,      // 5 seconds for database
  auth: 3000,    // 3 seconds for auth server
  world: 25000,  // 25 seconds for world server
  process: 1000  // 1 second for general process operations
};

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

function launchProcess(name, command, args = []) {
  if (processes[name]) {
    return false; // Already running
  }

  console.log(`Launching ${name} with command: ${command}`);
  
  try {
    const proc = spawn(command, args, { 
      detached: false, // Change to false to maintain process control
      shell: true,
      windowsHide: process.platform === 'win32' && name === 'db',
      cwd: path.dirname(command), // Set working directory to the directory containing the executable
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
      mainWindow.webContents.send('process-status', name, 'Error');
    });

    proc.on('exit', (code, signal) => {
      console.log(`${name} exited with code ${code} and signal ${signal}`);
      processes[name] = null;
      mainWindow.webContents.send('process-status', name, 'Stopped');
      mainWindow.webContents.send('process-log', name, 'info', `Process exited with code ${code}`);
    });

    processes[name] = proc;
    if (['db', 'auth', 'world'].includes(name)) {
      const startDelay = SERVER_DELAYS[name];
      mainWindow.webContents.send('process-status', name, `Starting-${startDelay}`);
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

async function restartProcess(name, command, args = []) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  if (processes[name]) {
    processes[name].kill();
    processes[name] = null;
    mainWindow.webContents.send('process-status', name, 'Stopped');
    // Small delay to ensure clean shutdown
    await delay(SERVER_DELAYS.process);
  }

  const started = launchProcess(name, command, args);
  if (started) {
    if (name === 'db' || name === 'auth' || name === 'world') {
      const startDelay = SERVER_DELAYS[name];
      mainWindow.webContents.send('process-status', name, `Starting-${startDelay}`);
      await delay(startDelay);
      mainWindow.webContents.send('process-status', name, 'Running');
    } else {
      mainWindow.webContents.send('process-status', name, 'Running');
    }
  }
  return started;
}

// IPC handlers for UI commands
ipcMain.handle('launch', async (event, name) => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  const started = launchProcess(name, config.paths[name]);
  if (started && ['db', 'auth', 'world'].includes(name)) {
    await delay(SERVER_DELAYS[name]);
    mainWindow.webContents.send('process-status', name, 'Running');
  }
  return started;
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
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  try {
    // Start servers in sequence: DB -> Auth -> World
    const serverSequence = ['db', 'auth', 'world'];
    
    for (const serverName of serverSequence) {
      if (!processes[serverName]) {
        launchProcess(serverName, config.paths[serverName]);
        const startDelay = SERVER_DELAYS[serverName];
        mainWindow.webContents.send('process-status', serverName, `Starting-${startDelay}`);
        await delay(startDelay);
        mainWindow.webContents.send('process-status', serverName, 'Running');
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
  if (!processes[name]) return false;

  try {
    // On Windows, we need to kill the entire process tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', processes[name].pid, '/f', '/t']);
    } else {
      processes[name].kill('SIGTERM');
    }
    
    // Wait for the process to actually end
    await new Promise((resolve) => {
      processes[name].once('exit', resolve);
      // Fallback if process doesn't exit
      setTimeout(resolve, 5000);
    });
    
    processes[name] = null;
    console.log(`${name} process terminated`);
    return true;
  } catch (error) {
    console.error(`Error killing ${name} process:`, error);
    return false;
  }
});

// Handle graceful shutdown of all servers
ipcMain.handle('stop-all', async () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  const stopProcess = async (name) => {
    if (!processes[name]) return true;
    
    try {
      // On Windows, we need to kill the entire process tree
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', processes[name].pid, '/f', '/t']);
      } else {
        processes[name].kill('SIGTERM');
      }
      
      // Wait for the process to actually end
      await new Promise((resolve) => {
        processes[name].once('exit', resolve);
        // Fallback if process doesn't exit
        setTimeout(resolve, 5000);
      });
      
      processes[name] = null;
      console.log(`${name} process terminated`);
      return true;
    } catch (error) {
      console.error(`Error killing ${name} process:`, error);
      return false;
    }
  };

  // Stop world server first
  await stopProcess('world');
  await delay(1000);
  
  // Then stop auth server
  await stopProcess('auth');
  await delay(1000);
  
  // Finally stop MySQL/DB
  await stopProcess('db');
  
  return true;
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle restart all servers
ipcMain.handle('restart-all', async () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  const killProcess = async (proc, name) => {
    if (!proc) return;
    
    try {
      // On Windows, we need to kill the entire process tree
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
      } else {
        proc.kill('SIGTERM');
      }
      
      // Wait for the process to actually end
      await new Promise((resolve) => {
        proc.once('exit', resolve);
        // Fallback if process doesn't exit
        setTimeout(resolve, 5000);
      });
      
      processes[name] = null;
      mainWindow.webContents.send('process-status', name, 'Stopped');
      console.log(`${name} process terminated`);
    } catch (error) {
      console.error(`Error killing ${name} process:`, error);
    }
  };

  try {
    // Stop all servers first
    if (processes['world']) {
      await killProcess(processes['world'], 'world');
      await delay(2000);
    }
    
    if (processes['auth']) {
      await killProcess(processes['auth'], 'auth');
      await delay(2000);
    }
    
    if (processes['db']) {
      await killProcess(processes['db'], 'db');
    }

    // Wait additional 5 seconds before starting
    await delay(5000);
    
    // Start all servers again
    if (!processes['db']) {
      launchProcess('db', config.paths.db);
      mainWindow.webContents.send('process-status', 'db', 'Starting-5000');
      await delay(5000);
      mainWindow.webContents.send('process-status', 'db', 'Running');
    }
    
    if (!processes['auth']) {
      launchProcess('auth', config.paths.auth);
      mainWindow.webContents.send('process-status', 'auth', 'Starting-3000');
      await delay(3000);
      mainWindow.webContents.send('process-status', 'auth', 'Running');
    }
    
    if (!processes['world']) {
      launchProcess('world', config.paths.world);
      mainWindow.webContents.send('process-status', 'world', 'Starting-15000');
      await delay(15000);
      mainWindow.webContents.send('process-status', 'world', 'Running');
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
