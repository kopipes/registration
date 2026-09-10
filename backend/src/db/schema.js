'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function getDb() {
  return db;
}

function initDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      full_name   TEXT NOT NULL,
      role        TEXT NOT NULL CHECK(role IN ('admin', 'official', 'crew')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS peserta (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nama        TEXT NOT NULL,
      nik         TEXT NOT NULL UNIQUE,
      email       TEXT,
      no_telpon   TEXT,
      seat        TEXT,
      section     TEXT,
      seat_number TEXT,
      qr_code     TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      peserta_id      INTEGER NOT NULL REFERENCES peserta(id),
      status          TEXT NOT NULL CHECK(status IN ('registered', 'cancelled')),
      registered_by   INTEGER REFERENCES users(id),
      registered_at   TEXT,
      cancelled_by    INTEGER REFERENCES users(id),
      cancelled_at    TEXT,
      cancel_reason   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id),
      username    TEXT,
      action      TEXT NOT NULL,
      entity      TEXT,
      entity_id   INTEGER,
      detail      TEXT,
      ip_address  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_peserta_nik      ON peserta(nik);
    CREATE INDEX IF NOT EXISTS idx_peserta_nama     ON peserta(nama);
    CREATE INDEX IF NOT EXISTS idx_peserta_section  ON peserta(section);
    CREATE INDEX IF NOT EXISTS idx_registrations_peserta ON registrations(peserta_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  `);

  // Seed default admin if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, password, full_name, role)
      VALUES ('admin', ?, 'Administrator', 'admin')
    `).run(hash);
    console.log('Default admin created — username: admin, password: admin123');
  }

  return db;
}

module.exports = { initDb, getDb };
