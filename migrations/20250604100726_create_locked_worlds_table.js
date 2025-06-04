/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('locked_worlds', function(table) {
    table.increments('id').primary();
    table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('world_name').notNullable();
    table.string('lock_type').notNullable().defaultTo('main');
    table.text('note').nullable();
    table.timestamp('locked_on_date').defaultTo(knex.fn.now());
    table.unique(['user_id', 'world_name']);
    table.index(['user_id']);
    table.index(['world_name']);
    table.index(['lock_type']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('locked_worlds');
};
