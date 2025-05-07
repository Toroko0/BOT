// Test script to verify database connection
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

console.log('Starting database test...');

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  console.log('Creating database directory:', dbDir);
  fs.mkdirSync(dbDir);
}

// Create a database connection
const dbPath = path.join(__dirname, 'data', 'worlds.db');
console.log('Connecting to database at:', dbPath);

try {
  const db = new sqlite3.Database(dbPath);
  
  // Verify connection with a simple query
  db.run('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)', (err) => {
    if (err) {
      console.error('Error creating test table:', err);
    } else {
      console.log('Test table created successfully');
      
      // Run a simple query to verify the database is working
      db.get('SELECT sqlite_version() as version', (err, row) => {
        if (err) {
          console.error('Error querying SQLite version:', err);
        } else {
          console.log('SQLite version:', row.version);
          console.log('Database connection successful');
        }
        
        // Close the database connection
        db.close();
      });
    }
  });
} catch (error) {
  console.error('Error connecting to database:', error);
}