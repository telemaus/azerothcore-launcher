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

// Listen for status updates from main process
ipcRenderer.on('process-status', (event, name, status) => {
  if (buttons[name]) {
    const statusElement = buttons[name].status;
    if (status === 'Running') {
      statusElement.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" fill="#22c55e" viewBox="0 0 256 256">
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"></path>
        </svg>`;
    } else if (status.startsWith('Starting-')) {
      const duration = parseInt(status.split('-')[1]);
      statusElement.innerHTML = `
        <svg class="progress-circle" width="18px" height="18px" viewBox="0 0 32 32">
          <circle
            class="progress-background"
            r="14"
            cx="16"
            cy="16"
            fill="none"
            stroke="#e5e5e5"
            stroke-width="2.5"
          />
          <circle
            class="progress-indicator"
            r="14"
            cx="16"
            cy="16"
            fill="none"
            stroke="#3b82f6"
            stroke-width="2.5"
            stroke-dasharray="87.96"
            stroke-dashoffset="87.96"
            transform="rotate(-90 16 16)"
            style="animation: progress-animation ${duration}ms ease-out forwards"
          />
        </svg>`;
      // Add the animation style if it doesn't exist
      if (!document.getElementById('progress-animation-style')) {
        const style = document.createElement('style');
        style.id = 'progress-animation-style';
        style.textContent = `
          @keyframes progress-animation {
            0% {
              stroke-dashoffset: 87.96;
            }
            100% {
              stroke-dashoffset: 0;
            }
          }
          .progress-circle {
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
          }
        `;
        document.head.appendChild(style);
      }
    } else if (status === 'Error') {
      statusElement.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" fill="#ef4444" viewBox="0 0 256 256">
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path>
        </svg>`;
    } else {
      statusElement.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" fill="currentColor" viewBox="0 0 256 256">
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z"></path>
        </svg>`;
    }
  }
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
  if (confirm('Do you want to reconfigure the server paths?')) {
    optionsButton.disabled = true;
    optionsButton.textContent = 'Configuring...';
    const result = await ipcRenderer.invoke('reconfigure');
    optionsButton.textContent = 'Options';
    optionsButton.disabled = false;
    if (!result) {
      alert('Failed to save the configuration. Please try again.');
    }
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


