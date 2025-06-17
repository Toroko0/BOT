'use strict';

/** @param {import('knex').Knex} knex */
exports.up = function(knex) {
  return knex.schema.table('worlds', function(table) {
    // Drop the old unique constraint
    table.dropUnique(['name', 'user_id'], 'uq_worlds_name_user');
    // Add the new composite unique constraint
    table.unique(['user_id', 'name', 'days_owned', 'lock_type'], { indexName: 'uq_worlds_user_name_days_lock' });
  });
};

/** @param {import('knex').Knex} knex */
exports.down = function(knex) {
  return knex.schema.table('worlds', function(table) {
    // Drop the new unique constraint
    table.dropUnique(['user_id', 'name', 'days_owned', 'lock_type'], 'uq_worlds_user_name_days_lock');
    // Re-add the old unique constraint
    table.unique(['name', 'user_id'], { indexName: 'uq_worlds_name_user' });
  });
};
