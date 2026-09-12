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

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      logo_url    TEXT,
      event_name  TEXT,
      theme       TEXT DEFAULT 'navy',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS peserta (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL REFERENCES projects(id),
      nama            TEXT NOT NULL,
      nik             TEXT NOT NULL,
      email           TEXT,
      no_telpon       TEXT,
      seat            TEXT,
      section         TEXT,
      seat_number     TEXT,
      qr_code         TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1,
      upload_batch_id INTEGER REFERENCES upload_batches(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, nik)
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
      project_id  INTEGER REFERENCES projects(id),
      detail      TEXT,
      ip_address  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS upload_batches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id),
      filename    TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_rows  INTEGER NOT NULL DEFAULT 0,
      inserted    INTEGER NOT NULL DEFAULT 0,
      skipped     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS upload_mappings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id),
      field       TEXT NOT NULL,
      source_column TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, field)
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
    CREATE INDEX IF NOT EXISTS idx_projects_status  ON projects(status);
  `);

  // === MIGRATIONS (idempotent, safe to re-run) ===

  // Migration 1: v1 single-tenant → multi-project (rebuilds peserta table)
  migrateToMultiProject();

  // Index on migrated column — safe after migration has run
  db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_batch ON peserta(upload_batch_id)');

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

function migrateToMultiProject() {
  // Detect old single-tenant peserta (no project_id column)
  const cols = db.pragma('table_info(peserta)').map(c => c.name);

  if (cols.includes('project_id')) return; // already migrated

  console.log('Migrating to multi-project schema...');

  // Table rebuilds with FK references require FK enforcement off during
  // migration (standard SQLite table-rebuild procedure). Single-connection,
  // sync driver — no concurrent writes possible during this block.
  db.pragma('foreign_keys = OFF');
  try {
    migrateToMultiProjectInner();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Post-migration integrity check
  const fkCheck = db.pragma('foreign_key_check');
  if (fkCheck.length > 0) {
    console.error('WARNING: foreign key violations detected after migration:', fkCheck);
  } else {
    console.log('Migration integrity check passed (no FK violations)');
  }
}

function migrateToMultiProjectInner() {
  const migrate = db.transaction(() => {
    // 1. Create default project from current settings (or fallback name)
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const eventName = settings.event_name || 'Project 1';
    const result = db.prepare(`
      INSERT INTO projects (name, status, logo_url, event_name, theme)
      VALUES (?, 'active', ?, ?, ?)
    `).run(eventName, settings.logo_url || null, eventName, settings.theme || 'navy');
    const projectId = result.lastInsertRowid;

    // 2. Rebuild peserta with project_id + composite unique
    //    (SQLite can't ALTER constraints — copy table)
    db.exec(`
      CREATE TABLE peserta_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id      INTEGER NOT NULL REFERENCES projects(id),
        nama            TEXT NOT NULL,
        nik             TEXT NOT NULL,
        email           TEXT,
        no_telpon       TEXT,
        seat            TEXT,
        section         TEXT,
        seat_number     TEXT,
        qr_code         TEXT,
        is_active       INTEGER NOT NULL DEFAULT 1,
        upload_batch_id INTEGER REFERENCES upload_batches(id),
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, nik)
      );
    `);
    // Copy data — preserve IDs (registrations & peserta reference them)
    const srcCols = db.pragma('table_info(peserta)').map(c => c.name);
    const hasBatchCol = srcCols.includes('upload_batch_id');
    const targetCols = [
      'id', 'project_id', 'nama', 'nik', 'email', 'no_telpon', 'seat', 'section',
      'seat_number', 'qr_code', 'is_active',
      ...(hasBatchCol ? ['upload_batch_id'] : []),
      'created_at', 'updated_at',
    ];
    const selectCols = targetCols.map(c => c === 'project_id' ? '?' : c).join(', ');
    db.prepare(`
      INSERT INTO peserta_new (${targetCols.join(', ')})
      SELECT ${selectCols}
      FROM peserta
    `).run(projectId);
    db.exec('DROP TABLE peserta');
    db.exec('ALTER TABLE peserta_new RENAME TO peserta');

    db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_nik      ON peserta(nik)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_nama     ON peserta(nama)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_section  ON peserta(section)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_batch    ON peserta(upload_batch_id)');

    // 3. upload_batches: add project_id
    const batchCols = db.pragma('table_info(upload_batches)').map(c => c.name);
    if (!batchCols.includes('project_id')) {
      db.exec(`
        CREATE TABLE upload_batches_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id  INTEGER NOT NULL REFERENCES projects(id),
          filename    TEXT NOT NULL,
          uploaded_by INTEGER REFERENCES users(id),
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
          total_rows  INTEGER NOT NULL DEFAULT 0,
          inserted    INTEGER NOT NULL DEFAULT 0,
          skipped     INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.prepare(`
        INSERT INTO upload_batches_new (id, project_id, filename, uploaded_by, uploaded_at,
                                        total_rows, inserted, skipped)
        SELECT id, ?, filename, uploaded_by, uploaded_at, total_rows, inserted, skipped
        FROM upload_batches
      `).run(projectId);
      db.exec('DROP TABLE upload_batches');
      db.exec('ALTER TABLE upload_batches_new RENAME TO upload_batches');
    }

    // 4. audit_log: add project_id column (nullable, historical entries stay null)
    const auditCols = db.pragma('table_info(audit_log)').map(c => c.name);
    if (!auditCols.includes('project_id')) {
      db.exec('ALTER TABLE audit_log ADD COLUMN project_id INTEGER REFERENCES projects(id)');
    }

    console.log(`Migration done — default project #${projectId} (${eventName}) created`);
  });

  migrate();
}

module.exports = { initDb, getDb };
