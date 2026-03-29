import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const BACKUP_DIR = path.join(process.cwd(), "data", "backups");
const MAX_BACKUPS = 10;
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const BACKUP_PREFIX = "brain-backup-";
const BACKUP_EXT = ".db";

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
}

let _db: Database.Database | null = null;
let _dbPath = "";

// Survive hot-reload in dev: store scheduled flag on globalThis
const _global = globalThis as unknown as { __backupScheduled?: boolean };


function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

export function listBackups(): BackupInfo[] {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_EXT));
  return files
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.filename.localeCompare(a.filename));
}

function rotateBackups(max = MAX_BACKUPS): void {
  const backups = listBackups();
  if (backups.length > max) {
    for (const old of backups.slice(max)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.filename));
    }
  }
}

export async function createBackup(prefix?: string): Promise<BackupInfo> {
  if (!_db) throw new Error("Database not initialized for backup");
  ensureBackupDir();
  const filename = `${prefix ?? BACKUP_PREFIX}${formatTimestamp()}${BACKUP_EXT}`;
  const dest = path.join(BACKUP_DIR, filename);
  await _db.backup(dest);
  if (!prefix || prefix === BACKUP_PREFIX) {
    rotateBackups();
  }
  const stat = fs.statSync(dest);
  return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
}

export function restoreFromBackup(
  filename: string,
  resetDb: () => void,
  reinitDb: () => void,
): void {
  if (!/^[a-zA-Z0-9_.-]+\.db$/.test(filename)) {
    throw new Error("Invalid backup filename");
  }
  const backupPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file not found");
  }

  // Safety backup before restore
  const safetyName = `pre-restore-${formatTimestamp()}${BACKUP_EXT}`;
  if (_db) {
    const safetyDest = path.join(BACKUP_DIR, safetyName);
    ensureBackupDir();
    const source = fs.readFileSync(_dbPath);
    fs.writeFileSync(safetyDest, source);
  }

  resetDb();
  _db = null;

  fs.copyFileSync(backupPath, _dbPath);
  // Remove stale WAL/SHM files
  const shm = _dbPath + "-shm";
  const wal = _dbPath + "-wal";
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
  if (fs.existsSync(wal)) fs.unlinkSync(wal);

  // Re-initialize DB singleton (which also updates _db via initBackupSchedule)
  reinitDb();
}

export function initBackupSchedule(db: Database.Database, dbPath: string): void {
  _db = db;
  _dbPath = dbPath;

  if (_global.__backupScheduled) return;
  _global.__backupScheduled = true;

  createBackup().catch((err) => console.error("[backup] startup backup failed:", err));
  setInterval(() => {
    createBackup().catch((err) => console.error("[backup] scheduled backup failed:", err));
  }, BACKUP_INTERVAL_MS);
}
