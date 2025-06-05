/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('worlds', function(table) {
    table.renameColumn('custom_id', 'note');
  });
  // For databases other than SQLite, you might need to explicitly rename constraints:
  // await knex.raw('ALTER TABLE worlds RENAME CONSTRAINT uq_worlds_customid_user TO uq_worlds_note_user;');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('worlds', function(table) {
    table.renameColumn('note', 'custom_id');
  });
  // For databases other than SQLite, you might need to explicitly rename constraints back:
  // await knex.raw('ALTER TABLE worlds RENAME CONSTRAINT uq_worlds_note_user TO uq_worlds_customid_user;');
};
