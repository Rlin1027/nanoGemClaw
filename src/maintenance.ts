import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

let maintenanceMode = false;

const CONFIG_FILE = path.join(DATA_DIR, 'dashboard-config.json');

interface DashboardConfig {
  maintenanceMode: boolean;
}

export function isMaintenanceMode(): boolean {
  return maintenanceMode;
}

export function setMaintenanceMode(enabled: boolean): void {
  maintenanceMode = enabled;

  try {
    // Ensure data directory exists
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // Read existing config or create new one
    let config: DashboardConfig = { maintenanceMode: enabled };

    try {
      const existingData = fs.readFileSync(CONFIG_FILE, 'utf-8');
      config = JSON.parse(existingData);
      config.maintenanceMode = enabled;
    } catch {
      // File doesn't exist or is invalid, use new config
    }

    // Write updated config
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    // Silently fail - maintenance mode still works in memory
    console.error('Failed to persist maintenance mode:', error);
  }
}

export function loadMaintenanceState(): void {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config: DashboardConfig = JSON.parse(data);
    maintenanceMode = config.maintenanceMode ?? false;
  } catch {
    // File doesn't exist or is invalid, use default (false)
    maintenanceMode = false;
  }
}
