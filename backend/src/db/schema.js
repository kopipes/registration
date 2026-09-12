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
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      logo_url    TEXT,
      event_name  TEXT,
      theme       TEXT DEFAULT 'navy',
      unique_fields TEXT DEFAULT '["nik","email"]',
      extra_labels TEXT DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS peserta (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL REFERENCES projects(id),
      nama            TEXT NOT NULL,
      kode            TEXT,
      nik             TEXT,
      email           TEXT,
      no_telpon       TEXT,
      seat            TEXT,
      section         TEXT,
      seat_number     TEXT,
      qr_code         TEXT,
      extra1          TEXT,
      extra2          TEXT,
      extra3          TEXT,
      extra4          TEXT,
      extra5          TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1,
      upload_batch_id INTEGER REFERENCES upload_batches(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS upload_batches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id),
      filename    TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      total_rows  INTEGER NOT NULL DEFAULT 0,
      inserted    INTEGER NOT NULL DEFAULT 0,
      skipped     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS upload_mappings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id),
      field       TEXT NOT NULL,
      source_column TEXT NOT NULL DEFAULT '',
      source_label  TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(project_id, field)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

  // Migration 2: add unique_fields to projects (older multi-project DBs)
  const projCols = db.pragma('table_info(projects)').map(c => c.name);
  if (!projCols.includes('unique_fields')) {
    db.exec("ALTER TABLE projects ADD COLUMN unique_fields TEXT DEFAULT '[\"nik\",\"email\"]'");
    db.prepare("UPDATE projects SET unique_fields = ? WHERE unique_fields IS NULL")
      .run('["nik","email"]');
    console.log('Migration: added projects.unique_fields');
  }

  // Migration 3: participant `kode` field + drop hard NIK uniqueness
  // (identity field is now configurable per project, NIK may be empty)
  const pCols = db.pragma('table_info(peserta)').map(c => c.name);
  if (!pCols.includes('kode') || pCols.includes('nik') && isNikNotNull()) {
    migrateAddKodeField();
  }

  // Migration 4: shift historical UTC timestamps to WIB (UTC+7), once.
  migrateTimestampsToWib();

  // Migration 5: extra slots for custom Excel columns + per-project header labels
  const pCols2 = db.pragma('table_info(peserta)').map(c => c.name);
  if (!pCols2.includes('extra1')) {
    const baseCols = [
      'id', 'project_id', 'nama', 'kode', 'nik', 'email', 'no_telpon',
      'seat', 'section', 'seat_number', 'qr_code', 'is_active',
      'upload_batch_id', 'created_at', 'updated_at',
    ].filter(c => pCols2.includes(c));

    // Table rebuild requires FK enforcement off (registrations → peserta)
    db.pragma('foreign_keys = OFF');
    try {
      const rebuild = db.transaction(() => {
        db.exec('DROP TABLE IF EXISTS peserta_new');
        db.exec(`
      CREATE TABLE peserta_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id      INTEGER NOT NULL REFERENCES projects(id),
        nama            TEXT NOT NULL,
        kode            TEXT,
        nik             TEXT,
        email           TEXT,
        no_telpon       TEXT,
        seat            TEXT,
        section         TEXT,
        seat_number     TEXT,
        qr_code         TEXT,
        extra1          TEXT,
        extra2          TEXT,
        extra3          TEXT,
        extra4          TEXT,
        extra5          TEXT,
        is_active       INTEGER NOT NULL DEFAULT 1,
        upload_batch_id INTEGER REFERENCES upload_batches(id),
        created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);
        db.prepare(`
      INSERT INTO peserta_new (${baseCols.join(', ')})
      SELECT ${baseCols.join(', ')} FROM peserta
    `).run();
        db.exec('DROP TABLE peserta');
        db.exec('ALTER TABLE peserta_new RENAME TO peserta');
        db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_nik  ON peserta(nik)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_kode ON peserta(kode)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_nama ON peserta(nama)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_section ON peserta(section)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_batch ON peserta(upload_batch_id)');
      });
      rebuild();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    const fk5 = db.pragma('foreign_key_check');
    console.log(fk5.length === 0
      ? 'Migration: peserta extra1..extra5 added (FK clean)'
      : `WARNING: FK violations after extra-slot migration: ${JSON.stringify(fk5).slice(0, 150)}`);
  }

  const projCols2 = db.pragma('table_info(projects)').map(c => c.name);
  if (!projCols2.includes('extra_labels')) {
    db.exec("ALTER TABLE projects ADD COLUMN extra_labels TEXT DEFAULT '{}'");
    db.prepare("UPDATE projects SET extra_labels = '{}' WHERE extra_labels IS NULL").run();
    console.log('Migration: added projects.extra_labels');
  }

  const mapCols = db.pragma('table_info(upload_mappings)').map(c => c.name);
  if (!mapCols.includes('source_label')) {
    db.exec('ALTER TABLE upload_mappings ADD COLUMN source_label TEXT');
    console.log('Migration: added upload_mappings.source_label');
  }

  // Migration 6: token_version for session revocation
  const userCols = db.pragma('table_info(users)').map(c => c.name);
  if (!userCols.includes('token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1');
    console.log('Migration: added users.token_version');
  }

  // Index on migrated column — safe after migration has run
  db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_batch ON peserta(upload_batch_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_kode  ON peserta(kode)');

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
    db.exec('DROP TABLE IF EXISTS peserta_new');
    db.exec(`
      CREATE TABLE peserta_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id      INTEGER NOT NULL REFERENCES projects(id),
        nama            TEXT NOT NULL,
        kode            TEXT,
        nik             TEXT,
        email           TEXT,
        no_telpon       TEXT,
        seat            TEXT,
        section         TEXT,
        seat_number     TEXT,
        qr_code         TEXT,
        is_active       INTEGER NOT NULL DEFAULT 1,
        upload_batch_id INTEGER REFERENCES upload_batches(id),
        created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
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

function isNikNotNull() {
  // Returns true if nik still has a NOT NULL / UNIQUE constraint (old schema)
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='peserta'").get();
  if (!sql?.sql) return false;
  return /nik\s+TEXT\s+NOT NULL/i.test(sql.sql) || /UNIQUE\s*\(\s*project_id\s*,\s*nik/i.test(sql.sql);
}

function migrateAddKodeField() {
  console.log('Migrating: add peserta.kode, relax NIK constraints...');

  db.pragma('foreign_keys = OFF');
  try {
    const migrate = db.transaction(() => {
      const cols = db.pragma('table_info(peserta)').map(c => c.name);
      const hasKode = cols.includes('kode');
      const hasBatch = cols.includes('upload_batch_id');

      db.exec('DROP TABLE IF EXISTS peserta_new');
      db.exec(`
        CREATE TABLE peserta_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id      INTEGER NOT NULL REFERENCES projects(id),
          nama            TEXT NOT NULL,
          kode            TEXT,
          nik             TEXT,
          email           TEXT,
          no_telpon       TEXT,
          seat            TEXT,
          section         TEXT,
          seat_number     TEXT,
          qr_code         TEXT,
          is_active       INTEGER NOT NULL DEFAULT 1,
          upload_batch_id INTEGER REFERENCES upload_batches(id),
          created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
      `);

      const targetCols = [
        'id', 'project_id', 'nama',
        ...(hasKode ? ['kode'] : []),
        'nik', 'email', 'no_telpon', 'seat', 'section', 'seat_number', 'qr_code', 'is_active',
        ...(hasBatch ? ['upload_batch_id'] : []),
        'created_at', 'updated_at',
      ];
      db.prepare(`
        INSERT INTO peserta_new (${targetCols.join(', ')})
        SELECT ${targetCols.join(', ')} FROM peserta
      `).run();

      db.exec('DROP TABLE peserta');
      db.exec('ALTER TABLE peserta_new RENAME TO peserta');
      db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_nik  ON peserta(nik)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_kode ON peserta(kode)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_nama ON peserta(nama)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_section ON peserta(section)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_peserta_batch ON peserta(upload_batch_id)');
    });
    migrate();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const fk = db.pragma('foreign_key_check');
  console.log(fk.length === 0
    ? 'Migration integrity check passed (no FK violations)'
    : `WARNING: FK violations after kode migration: ${JSON.stringify(fk).slice(0, 200)}`);
}

function migrateTimestampsToWib() {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'tz_migrated_wib'").get();
  if (done?.value === '1') return;

  console.log('Migrating historical timestamps UTC → WIB (+7h)...');

  const shift = (table, col) => {
    try {
      db.prepare(
        `UPDATE ${table} SET ${col} = datetime(${col}, '+7 hours')
         WHERE ${col} IS NOT NULL AND ${col} != ''`
      ).run();
    } catch (e) {
      console.error(`  skip ${table}.${col}: ${e.message}`);
    }
  };

  const pairs = [
    ['users', 'created_at'], ['users', 'updated_at'],
    ['peserta', 'created_at'], ['peserta', 'updated_at'],
    ['registrations', 'created_at'],
    ['registrations', 'registered_at'], ['registrations', 'cancelled_at'],
    ['audit_log', 'created_at'],
    ['upload_batches', 'uploaded_at'],
    ['projects', 'created_at'], ['projects', 'updated_at'],
    ['upload_mappings', 'updated_at'],
    ['settings', 'updated_at'],
  ];

  const run = db.transaction(() => {
    for (const [table, col] of pairs) shift(table, col);
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('tz_migrated_wib', '1', datetime('now','localtime'))
      ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now','localtime')
    `).run();
  });
  run();

  console.log('Timestamp migration to WIB complete');
}

module.exports = { initDb, getDb };
