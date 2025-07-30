/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('users', (table) => {
    table.string('id').primary().comment('Discord User ID');
    table.string('username').notNullable().comment('Discord Username');
    table.float('timezone_offset').defaultTo(0.0);
    table.string('view_mode').defaultTo('pc');
    table.boolean('reminder_enabled').defaultTo(false);
    table.string('reminder_time_utc').nullable();
    table.timestamp('bot_join_date').defaultTo(knex.fn.now());
    table.string('bio').nullable();
    table.string('bot_username').nullable().unique();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('users');
};
