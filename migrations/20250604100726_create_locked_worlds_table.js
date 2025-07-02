// migrations/20250604100726_create_locked_worlds_table.js
// Original file was deleted, this is a placeholder to satisfy Knex
// and provide a way to roll back the schema if needed.

exports.up = async function(knex) {
  // This migration was recorded as run in the database, but its file was deleted.
  // This 'up' function is intentionally empty. If this migration had NOT run
  // according to the DB, then the original 'up' logic would be needed here.
  // For this fix, we assume the DB thinks it ran.
  console.log('Migration 20250604100726_create_locked_worlds_table.js: up method (no-op - placeholder for deleted file)');
  return Promise.resolve();
};

exports.down = async function(knex) {
  // This 'down' function attempts to reverse what the original migration did.
  // We assume it created a table named 'locked_worlds'.
  console.log('Migration 20250604100726_create_locked_worlds_table.js: down method - dropping locked_worlds table if exists');
  const tableExists = await knex.schema.hasTable('locked_worlds');
  if (tableExists) {
    return knex.schema.dropTable('locked_worlds');
  }
  return Promise.resolve();
};
