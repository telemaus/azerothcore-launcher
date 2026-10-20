const { ipcRenderer } = require('electron');

const buttons = {
  'db': {
    launch: document.getElementById('launch-db'),
    restart: document.getElementById('restart-db'),
    stop: document.getElementById('stop-db'),
    status: document.getElementById('status-db')
  },
  'auth': {
    launch: document.getElementById('launch-auth'),
    restart: document.getElementById('restart-auth'),
    stop: document.getElementById('stop-auth'),
    status: document.getElementById('status-auth')
  },
  'world': {
    launch: document.getElementById('launch-world'),
    restart: document.getElementById('restart-world'),
    stop: document.getElementById('stop-world'),
    status: document.getElementById('status-world')
  },
  'client': {
    launch: document.getElementById('launch-client'),
    restart: document.getElementById('restart-client'),
    stop: document.getElementById('stop-client'),
    status: document.getElementById('status-client')
  }
};

for (const [name, btns] of Object.entries(buttons)) {
  if (btns.launch) {
    btns.launch.addEventListener('click', async () => {
      const result = await ipcRenderer.invoke('launch', name);
      if (!result) alert(`${name} is already running or failed to launch.`);
    });
  }
  if (btns.stop) {
    btns.stop.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to stop the ${name.toUpperCase()}?`)) {
        const result = await ipcRenderer.invoke('stop', name);
        if (!result) alert(`${name} failed to stop.`);
      }
    });
  }
}

function renderServiceStatus(name, status) {
  const statusElement = buttons[name] && buttons[name].status;
  if (!statusElement) {
    return;
  }

  const color = status === 'Running' ? '#22c55e'
    : status === 'Starting' ? '#f59e0b'
      : status === 'Error' ? '#ef4444'
        : '#9ca3af';
  const shape = status === 'Stopped'
    ? '<circle cx="128" cy="128" r="86" fill="none" stroke="#9ca3af" stroke-width="18"></circle>'
    : `<circle cx="128" cy="128" r="58" fill="${color}"></circle>`;
  statusElement.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" aria-hidden="true">${shape}</svg>`;
  statusElement.title = status === 'Running' ? 'Ready'
    : status === 'Starting' ? 'Starting'
      : status === 'Error' ? 'Error'
        : 'Stopped';
  statusElement.setAttribute('aria-label', statusElement.title);
}

ipcRenderer.on('process-status', (_event, name, status) => {
  renderServiceStatus(name, status);
});

ipcRenderer.invoke('get-service-statuses').then((statuses) => {
  for (const [name, status] of Object.entries(statuses)) {
    renderServiceStatus(name, status);
  }
}).catch((error) => {
  console.error('Could not load service statuses:', error);
});

// Add start all button handler
const startAllButton = document.getElementById('start-all');
startAllButton.addEventListener('click', async () => {
  startAllButton.disabled = true;
  startAllButton.textContent = 'Starting...';
  const result = await ipcRenderer.invoke('start-all');
  if (!result) {
    alert('Failed to start all components. Check the logs for details.');
  }
  startAllButton.textContent = 'Start Servers';
  startAllButton.disabled = false;
});

// Add stop all servers button handler
const stopAllButton = document.getElementById('stop-all');
stopAllButton.addEventListener('click', async () => {
  if (confirm('Are you sure you want to stop all servers?')) {
    stopAllButton.disabled = true;
    stopAllButton.textContent = 'Stopping Servers...';
    await ipcRenderer.invoke('stop-all');
    stopAllButton.textContent = 'Stop Servers';
    stopAllButton.disabled = false;
  }
});

// Add options button handler
const optionsButton = document.getElementById('options-button');
optionsButton.addEventListener('click', async () => {
  optionsButton.disabled = true;
  try {
    await ipcRenderer.invoke('open-path-settings');
  } catch (error) {
    console.error('Could not open path settings:', error);
    alert(`Could not open path settings: ${error.message}`);
  } finally {
    optionsButton.disabled = false;
  }
});

// Add restart all servers button handler
const restartAllButton = document.getElementById('restart-all');
restartAllButton.addEventListener('click', async () => {
  if (confirm('Are you sure you want to restart all servers?')) {
    restartAllButton.disabled = true;
    restartAllButton.textContent = 'Restarting...';
    const result = await ipcRenderer.invoke('restart-all');
    if (!result) {
      alert('Failed to restart all servers. Check the logs for details.');
    }
    restartAllButton.textContent = 'Restart Servers';
    restartAllButton.disabled = false;
  }
});
