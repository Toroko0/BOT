// migrations/20250605000000_add_profile_fields_to_users.js
// Original file was deleted, this is a placeholder.

exports.up = async function(knex) {
  console.log('Migration 20250605000000_add_profile_fields_to_users.js: up method (no-op - placeholder for deleted file)');
  return Promise.resolve();
};

exports.down = async function(knex) {
  console.log('Migration 20250605000000_add_profile_fields_to_users.js: down method - dropping profile columns from users table if they exist');
  // The original migration likely added: bio, diamond_locks_balance, notify_on_new_message
  // Note: 'bio' might also be handled by 20250609000000_add_bio_to_users_table.js

  const hasBio = await knex.schema.hasColumn('users', 'bio');
  const hasDiamondLocks = await knex.schema.hasColumn('users', 'diamond_locks_balance');
  const hasNotify = await knex.schema.hasColumn('users', 'notify_on_new_message');

  return knex.schema.table('users', function(table) {
    if (hasBio) {
      console.log('Dropping column: bio');
      table.dropColumn('bio');
    }
    if (hasDiamondLocks) {
      console.log('Dropping column: diamond_locks_balance');
      table.dropColumn('diamond_locks_balance');
    }
    if (hasNotify) {
      console.log('Dropping column: notify_on_new_message');
      table.dropColumn('notify_on_new_message');
    }
  });
};
