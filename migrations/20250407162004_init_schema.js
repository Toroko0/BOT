/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('users', (table) => {
    table.string('id').primary().comment('Discord User ID');
    table.string('username').notNullable().comment('Discord Username');
    table.timestamp('joined_date').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('worlds', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().comment('Growtopia World Name (UPPERCASE)');
    table.integer('days_owned').defaultTo(1).comment('Used to calculate initial expiry');
    table.timestamp('expiry_date').notNullable().comment('Calculated Expiry Date (UTC)');
    table.enu('lock_type', ['mainlock', 'outlock']).defaultTo('mainlock');
    table.boolean('is_public').defaultTo(false).comment('Is world visible publicly?');
    table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE'); // Added onDelete CASCADE
    table.timestamp('added_date').defaultTo(knex.fn.now());
    table.string('custom_id').comment('Optional User-defined ID (UPPERCASE)');
    table.string('added_by').comment('Discord username of adder (for info)');
    // Indices
    table.index(['name', 'user_id'], 'idx_worlds_name_user'); // Specific name for index
    table.index(['user_id'], 'idx_worlds_user');
    table.index(['is_public'], 'idx_worlds_public');
    table.index(['expiry_date'], 'idx_worlds_expiry');
    table.index(['custom_id', 'user_id'], 'idx_worlds_customid_user');
    table.index(['days_owned'], 'idx_worlds_daysowned');
    // Unique Constraints (handle potential duplicates during migration or in separate script)
    table.unique(['name', 'user_id'], { indexName: 'uq_worlds_name_user' });
    // Custom ID should be unique per user, allow NULLs
    // SQLite handles unique constraint with NULL differently, needs explicit check or different approach if needed across DBs
    // For SQLite, a regular unique index allows multiple NULLs.
    table.unique(['custom_id', 'user_id'], { indexName: 'uq_worlds_customid_user'});
  });

  // Note: The unique constraints added above might fail if duplicate data exists.
  // Run the `migrate_add_unique_constraints.js` script *before* this migration if needed,
  // OR handle duplicate cleanup within a separate migration/script.

  await knex.schema.createTable('share_links', (table) => {
    table.increments('id').primary();
    table.integer('world_id').notNullable().references('id').inTable('worlds').onDelete('CASCADE'); // Added onDelete CASCADE
    table.string('token').unique().notNullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index(['token'], 'idx_sharelinks_token'); // Added index
  });

  await knex.schema.createTable('history', (table) => {
    table.increments('id').primary();
    // Allow NULL world_id in case world is deleted but history remains
    table.integer('world_id').nullable().references('id').inTable('worlds').onDelete('SET NULL');
    // Allow NULL user_id if needed, or keep NOT NULLABLE
    table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('action').notNullable();
    table.timestamp('timestamp').defaultTo(knex.fn.now());
    table.text('details').nullable();
    table.index(['world_id'], 'idx_history_world'); // Added indices
    table.index(['user_id'], 'idx_history_user');
    table.index(['action'], 'idx_history_action');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop in reverse order of creation due to foreign key constraints
  await knex.schema.dropTableIfExists('history');
  await knex.schema.dropTableIfExists('share_links');
  await knex.schema.dropTableIfExists('worlds');
  await knex.schema.dropTableIfExists('users');
};