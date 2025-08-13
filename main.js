const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { loadConfig, saveConfig, defaultConfig } = require('./config');

let mainWindow;
const processes = {};
let config = defaultConfig;

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
  await mainWindow.loadFile('index.html');

  // Load configuration after window is ready
  config = loadConfig();
  console.log('Configuration loaded:', config);
  if (!config.isConfigured) {
    await showSetupDialog();
  }
}

async function showSetupDialog() {
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'First Time Setup',
      message: 'Welcome to AzerothCore Launcher! We need to configure your server paths.',
      buttons: ['Configure Now', 'Exit'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 1) {
      app.quit();
      return;
    }

    // MySQL Database script selection
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'MySQL Start Script Selection',
      message: 'Please select your MySQL start script (start_mysql.bat)\n\nThis file is usually located in your AzerothCore server directory and is used to start the MySQL database.',
      buttons: ['Select File']
    });

    const dbResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Select MySQL Start Script (start_mysql.bat)',
      filters: [{ name: 'Batch Files', extensions: ['bat'] }],
      properties: ['openFile']
    });

    if (!dbResult.canceled) {
      config.paths.db = dbResult.filePaths[0];
    }

    // Auth Server selection
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Auth Server Selection',
      message: 'Please select your Auth Server executable (authserver.exe)\n\nThis is the authentication server that handles player logins. It should be in your AzerothCore server directory.',
      buttons: ['Select File']
    });

    const authResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Auth Server Executable (authserver.exe)',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    });

    if (!authResult.canceled) {
      config.paths.auth = authResult.filePaths[0];
    }

    // World Server selection
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'World Server Selection',
      message: 'Please select your World Server executable (worldserver.exe)\n\nThis is the main game server that handles the game world. It should be in your AzerothCore server directory.',
      buttons: ['Select File']
    });

    const worldResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Select World Server Executable (worldserver.exe)',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    });

    if (!worldResult.canceled) {
      config.paths.world = worldResult.filePaths[0];
    }

    // WoW Client selection
    const clientChoice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'WoW Client Selection',
      message: 'Would you like to configure the World of Warcraft client executable (Wow.exe)?\n\nThis is optional and can be configured later through the Options menu.',
      buttons: ['Select File', 'Skip'],
      defaultId: 0,
      cancelId: 1
    });

    if (clientChoice.response === 0) {
      const clientResult = await dialog.showOpenDialog(mainWindow, {
        title: 'Select WoW Client Executable (Wow.exe)',
        filters: [{ name: 'Executable', extensions: ['exe'] }],
        properties: ['openFile']
      });

      if (!clientResult.canceled) {
        config.paths.client = clientResult.filePaths[0];
      }
    }

    // Verify required paths are set (client is optional)
    if (config.paths.db && config.paths.auth && config.paths.world) {
      config.isConfigured = true;
      saveConfig(config);
      console.log('Configuration saved:', config);
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Setup Incomplete',
        message: 'Required server components were not configured. The application will now exit.',
        buttons: ['OK']
      });
      app.quit();
    }
  } catch (error) {
    console.error('Setup error:', error);
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Setup Error',
      message: 'An error occurred during setup. The application will now exit.',
      buttons: ['OK']
    });
    app.quit();
  }
}

function launchProcess(name, command, args = []) {
  if (processes[name]) {
    return false; // Already running
  }

  console.log(`Launching ${name} with command: ${command}`);
  
  try {
    const proc = spawn(command, args, { 
      detached: false, // Change to false to maintain process control
      shell: true,
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
  await showSetupDialog();
  return config.isConfigured;
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
      console.log(`${name} process terminated`);
    } catch (error) {
      console.error(`Error killing ${name} process:`, error);
    }
  };

  // Stop world server first
  if (processes['world']) {
    await killProcess(processes['world'], 'world');
    await delay(2000);
  }
  
  // Then stop auth server
  if (processes['auth']) {
    await killProcess(processes['auth'], 'auth');
    await delay(2000);
  }
  
  // Finally stop MySQL
  if (processes['db']) {
    await killProcess(processes['db'], 'db');
  }
  
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
