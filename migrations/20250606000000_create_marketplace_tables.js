/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.integer('diamond_locks_balance').notNullable().defaultTo(0);
  })
  .then(() => {
    return knex.schema.createTable('market_listings', function(table) {
      table.increments('id').primary();
      table.string('seller_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('locked_world_id').notNullable().unsigned().references('id').inTable('locked_worlds').onDelete('CASCADE').unique(); // Ensure a locked world can only be listed once
      table.integer('price_dl').notNullable();
      table.text('listing_note').nullable();
      table.timestamp('listed_on_date').defaultTo(knex.fn.now());

      table.index(['seller_user_id']);
      table.index(['price_dl']);
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('market_listings')
    .then(() => {
      return knex.schema.alterTable('users', function(table) {
        table.dropColumn('diamond_locks_balance');
      });
    });
};
