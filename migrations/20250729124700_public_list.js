/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add a new column to store the username of the person who added the world
  await knex.schema.alterTable('worlds', (table) => {
    table.string('added_by_username');
  });

  // Backfill the new 'added_by_username' column with data from the 'users' table
  await knex.raw(`
    UPDATE worlds
    SET added_by_username = (SELECT username FROM users WHERE users.id = worlds.user_id)
  `);

  // Now that the data is migrated, we can drop the old columns and the users table
  await knex.schema.alterTable('worlds', (table) => {
    table.dropColumn('user_id');
    table.dropColumn('is_public');
    table.dropColumn('guild_id');
  });

  await knex.schema.dropTableIfExists('users');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Re-create the 'users' table
  await knex.schema.createTable('users', (table) => {
    table.string('id').primary().comment('Discord User ID');
    table.string('username').notNullable().comment('Discord Username');
    table.timestamp('joined_date').defaultTo(knex.fn.now());
  });

  // Re-add the columns to the 'worlds' table
  await knex.schema.alterTable('worlds', (table) => {
    table.string('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.boolean('is_public').defaultTo(false);
    table.string('guild_id');
    table.dropColumn('added_by_username');
  });
};
