const { ipcRenderer } = require('electron');

const pathFields = {
  db: document.getElementById('dbPath'),
  auth: document.getElementById('authPath'),
  world: document.getElementById('worldPath'),
  client: document.getElementById('clientPath')
};
const message = document.getElementById('message');

function showMessage(text) {
  message.textContent = text || '';
}

function updateRevealButtons() {
  for (const [name, input] of Object.entries(pathFields)) {
    document.querySelector(`[data-reveal="${name}"]`).disabled = !input.value.trim();
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const paths = await ipcRenderer.invoke('get-config-paths');
    for (const [name, input] of Object.entries(pathFields)) {
      input.value = paths[name] || '';
      input.addEventListener('input', updateRevealButtons);
    }
    updateRevealButtons();
  } catch (error) {
    showMessage(`Could not load saved paths: ${error.message}`);
  }
});

for (const button of document.querySelectorAll('[data-browse]')) {
  button.addEventListener('click', async () => {
    const name = button.dataset.browse;
    try {
      const selectedPath = await ipcRenderer.invoke('select-config-path', name);
      if (selectedPath) {
        pathFields[name].value = selectedPath;
        updateRevealButtons();
        showMessage('');
      }
    } catch (error) {
      showMessage(`Could not browse for the file: ${error.message}`);
    }
  });
}

for (const button of document.querySelectorAll('[data-reveal]')) {
  button.addEventListener('click', async () => {
    const name = button.dataset.reveal;
    try {
      const error = await ipcRenderer.invoke('reveal-config-path', pathFields[name].value);
      showMessage(error || '');
    } catch (error) {
      showMessage(`Could not open File Explorer: ${error.message}`);
    }
  });
}

document.getElementById('save').addEventListener('click', async () => {
  const saveButton = document.getElementById('save');
  saveButton.disabled = true;
  showMessage('');
  try {
    const paths = Object.fromEntries(
      Object.entries(pathFields).map(([name, input]) => [name, input.value.trim()])
    );
    const result = await ipcRenderer.invoke('save-config-paths', paths);
    if (!result.success) {
      showMessage(result.error);
    }
  } catch (error) {
    showMessage(`Could not save paths: ${error.message}`);
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById('cancel').addEventListener('click', () => {
  ipcRenderer.invoke('close-path-settings');
});
