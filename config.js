const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
console.log('Config file location:', CONFIG_PATH);

const defaultConfig = {
    paths: {
        db: '',
        auth: '',
        world: '',
        client: ''
    },
    isConfigured: false
};

// For development: Delete existing config if it exists
if (process.env.NODE_ENV === 'development') {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            fs.unlinkSync(CONFIG_PATH);
            console.log('Development mode: Deleted existing config file');
        }
    } catch (error) {
        console.error('Error deleting config file:', error);
    }
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return defaultConfig;
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving config:', error);
        return false;
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    defaultConfig
};
