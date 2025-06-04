/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('direct_messages', function(table) {
    table.increments('id').primary();
    table.string('sender_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('recipient_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('message_content').notNullable();
    table.timestamp('sent_at').defaultTo(knex.fn.now());
    table.boolean('is_read').defaultTo(false);
    table.integer('parent_message_id').unsigned().nullable().references('id').inTable('direct_messages').onDelete('SET NULL');

    table.index(['sender_user_id']);
    table.index(['recipient_user_id']);
    table.index(['sent_at']);
    table.index(['is_read']);
    table.index(['recipient_user_id', 'is_read']); // For fetching unread messages for a user
  })
  .then(() => {
    return knex.schema.alterTable('users', function(table) {
      table.boolean('notify_on_new_message').notNullable().defaultTo(true);
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    // In SQLite, dropping columns can be problematic.
    // Knex handles this by recreating the table without the column for SQLite.
    // For other DBs, it's a simple DROP COLUMN.
    // Ensure your knexfile is correctly configured if issues arise with SQLite.
    // For robust down migrations with SQLite, often manual table recreation is advised
    // or simply ignoring the column drop if it's non-critical in dev.
    // However, Knex's alterTable().dropColumn() should attempt the correct strategy.
    table.dropColumn('notify_on_new_message');
  })
  .then(() => {
    return knex.schema.dropTableIfExists('direct_messages');
  });
};
