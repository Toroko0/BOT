/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('worlds', function(table) {
    table.renameColumn('custom_id', 'note');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('worlds', function(table) {
    table.renameColumn('note', 'custom_id');
  });
};
