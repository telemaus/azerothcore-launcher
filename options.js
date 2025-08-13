const { ipcRenderer } = require('electron');

// Load current paths and settings when window opens
window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.invoke('get-paths').then(paths => {
        document.getElementById('dbPath').textContent = paths.dbPath || 'Not set';
        document.getElementById('authPath').textContent = paths.authPath || 'Not set';
        document.getElementById('worldPath').textContent = paths.worldPath || 'Not set';
        document.getElementById('clientPath').textContent = paths.clientPath || 'Not set';
    });

    ipcRenderer.invoke('get-dark-mode').then(isDarkMode => {
        document.getElementById('darkMode').checked = isDarkMode;
    });
});

// Handle dark mode toggle
document.getElementById('darkMode').addEventListener('change', (event) => {
    const isDarkMode = event.target.checked;
    ipcRenderer.invoke('save-dark-mode', isDarkMode);
});

// Handle edit paths button
document.getElementById('editPaths').addEventListener('click', () => {
    ipcRenderer.invoke('show-path-setup');
});
