// migrations/20250609000000_add_bio_to_users_table.js
// Original file was deleted, this is a placeholder.

exports.up = async function(knex) {
  console.log('Migration 20250609000000_add_bio_to_users_table.js: up method (no-op - placeholder for deleted file)');
  return Promise.resolve();
};

exports.down = async function(knex) {
  console.log('Migration 20250609000000_add_bio_to_users_table.js: down method - dropping bio column from users table if exists');
  // This migration might have added or altered the 'bio' column.
  // The down function for 20250605000000_add_profile_fields_to_users.js also attempts to drop 'bio'.
  // This is okay; the hasColumn check makes it safe.

  const hasBio = await knex.schema.hasColumn('users', 'bio');

  if (hasBio) {
    console.log('Dropping column: bio (if not already dropped by another migration)');
    return knex.schema.table('users', function(table) {
      table.dropColumn('bio');
    });
  }

  return Promise.resolve();
};
