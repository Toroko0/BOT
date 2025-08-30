/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.dropTableIfExists('whitelist').then(() => {
    return knex.schema.createTable('whitelist', function(table) {
      table.string('id').primary();
      table.string('username').notNullable();
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('whitelist').then(() => {
    return knex.schema.createTable('whitelist', function(table) {
      table.string('username').primary();
    });
  });
};
