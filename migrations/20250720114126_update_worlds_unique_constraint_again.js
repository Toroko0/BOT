'use strict';

/** @param {import('knex').Knex} knex */
exports.up = function(knex) {
  return knex.schema.table('worlds', function(table) {
    // Drop the old unique constraint
    table.dropUnique(['user_id', 'name', 'days_owned', 'lock_type'], 'uq_worlds_user_name_days_lock');
    // Add the new composite unique constraint
    table.unique(['user_id', 'name', 'expiry_date', 'lock_type'], { indexName: 'uq_worlds_user_name_expiry_lock' });
  });
};

/** @param {import('knex').Knex} knex */
exports.down = function(knex) {
  return knex.schema.table('worlds', function(table) {
    // Drop the new unique constraint
    table.dropUnique(['user_id', 'name', 'expiry_date', 'lock_type'], 'uq_worlds_user_name_expiry_lock');
    // Re-add the old unique constraint
    table.unique(['user_id', 'name', 'days_owned', 'lock_type'], { indexName: 'uq_worlds_user_name_days_lock' });
  });
};
