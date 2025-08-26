/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('notifications_enabled');
    table.dropColumn('notification_interval');
    table.dropColumn('last_notification_timestamp');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.boolean('notifications_enabled').notNullable().defaultTo(true);
    table.integer('notification_interval').notNullable().defaultTo(6);
    table.timestamp('last_notification_timestamp').nullable();
  });
};
