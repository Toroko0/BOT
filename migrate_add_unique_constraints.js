const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'worlds.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('Starting migration to add unique constraints...');

  db.run('PRAGMA foreign_keys=off;');

  db.run(`CREATE TABLE IF NOT EXISTS worlds_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE,
    days_owned INTEGER DEFAULT 1,
    expiry_date TEXT NOT NULL,
    lock_type TEXT CHECK(lock_type IN ('mainlock', 'outlock')) DEFAULT 'mainlock',
    is_public INTEGER DEFAULT 0,
    user_id TEXT NOT NULL,
    added_date TEXT DEFAULT CURRENT_TIMESTAMP,
    custom_id TEXT COLLATE NOCASE,
    added_by TEXT,
    UNIQUE(name, user_id),
    UNIQUE(custom_id, user_id)
  );`, (err) => {
    if (err) {
      console.error('Error creating new table:', err);
      return;
    }

    db.run(`INSERT OR IGNORE INTO worlds_new (id, name, days_owned, expiry_date, lock_type, is_public, user_id, added_date, custom_id, added_by)
            SELECT id, name, days_owned, expiry_date, lock_type, is_public, user_id, added_date, custom_id, added_by FROM worlds;`, (err) => {
      if (err) {
        console.error('Error copying data:', err);
        return;
      }

      db.run('DROP TABLE worlds;', (err) => {
        if (err) {
          console.error('Error dropping old table:', err);
          return;
        }

        db.run('ALTER TABLE worlds_new RENAME TO worlds;', (err) => {
          if (err) {
            console.error('Error renaming new table:', err);
            return;
          }

          console.log('Migration completed successfully.');
        });
      });
    });
  });
});

db.close();
