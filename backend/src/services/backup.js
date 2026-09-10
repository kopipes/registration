'use strict';

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/schema');

const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const MAX_BACKUPS = 20; // keep last 20 backups

function runBackup() {
  const db = getDb();
  if (!db) return;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `registration-${timestamp}.db`);

  try {
    db.backup(backupPath).then(() => {
      console.log(`Backup created: ${backupPath}`);
      pruneBackups();
    }).catch((err) => {
      console.error('Backup failed:', err.message);
    });
  } catch (err) {
    console.error('Backup error:', err.message);
  }
}

function pruneBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length > MAX_BACKUPS) {
    files.slice(MAX_BACKUPS).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      console.log(`Pruned old backup: ${f.name}`);
    });
  }
}

function setupBackup() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', runBackup);
  console.log('Auto-backup scheduled every 15 minutes');
}

module.exports = { setupBackup, runBackup };
