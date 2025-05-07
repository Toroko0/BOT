// Update with your config settings.

const path = require('path'); // Import path for better file path handling

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {

  development: {
    client: 'sqlite3',
    connection: {
      // *** CORRECTED FILENAME ***
      filename: path.join(__dirname, 'data', 'worlds.db')
      // Using path.join ensures it works correctly regardless of where you run the script from
    },
    useNullAsDefault: true, // Recommended for SQLite
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'migrations') // Specify migrations directory
    }
  },

  staging: {
    client: 'postgresql',
    connection: {
      database: 'my_db',
      user:     'username',
      password: 'password'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'migrations')
    }
  },

  production: {
    client: 'postgresql',
    connection: {
      database: 'my_db',
      user:     'username',
      password: 'password'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'migrations')
    }
  }

};