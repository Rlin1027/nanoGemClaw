/**
 * IPC Tools for NanoGemClaw
 * File-based IPC for communicating with the host process
 */

import fs from 'fs';
import path from 'path';

export const IPC_DIR = '/workspace/ipc';
export const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
export const TASKS_DIR = path.join(IPC_DIR, 'tasks');

/**
 * Write a JSON file to the IPC directory with atomic write
 */
export function writeIpcFile(dir: string, data: object): string {
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = path.join(dir, filename);

    // Atomic write: temp file then rename
    const tempPath = `${filepath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filepath);

    return filename;
}

/**
 * Read a JSON file from the IPC directory
 */
export function readIpcFile<T>(filepath: string): T | null {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        }
    } catch {
        // Ignore parse errors
    }
    return null;
}
