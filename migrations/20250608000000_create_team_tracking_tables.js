/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // 1. 'teams' table
    .createTable('teams', function(table) {
      table.increments('id').primary();
      table.string('name').notNullable().unique(); // Case-insensitivity should be handled at application/query level if DB doesn't support CI UNIQUE directly
      table.string('owner_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('creation_date').defaultTo(knex.fn.now());
      table.index(['name']); // Index on name for faster lookups
    })
    // 2. 'team_members' table
    .createTable('team_members', function(table) {
      table.integer('team_id').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE');
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('join_date').defaultTo(knex.fn.now());
      table.primary(['team_id', 'user_id']); // Composite primary key
    })
    // 3. 'team_invitations' table
    .createTable('team_invitations', function(table) {
      table.increments('id').primary();
      table.integer('team_id').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE');
      table.string('code').notNullable().unique();
      table.string('created_by_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('used_at').nullable();
      table.string('used_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL'); // Keep record of who used it, even if they leave
      table.index(['code']); // Index on code for fast lookup
    })
    // 4. 'team_worlds' table
    .createTable('team_worlds', function(table) {
      table.increments('id').primary();
      table.integer('team_id').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE');
      table.string('world_name').notNullable();
      // Using expiry_date similar to 'worlds' table for consistency in calculating days_left/days_owned
      table.timestamp('expiry_date').notNullable();
      table.integer('days_owned').notNullable(); // Store the initial days_owned for reference
      table.text('note').nullable();
      table.string('added_by_user_id').notNullable().references('id').inTable('users').onDelete('SET NULL'); // Keep world even if adder leaves user table
      table.timestamp('added_date').defaultTo(knex.fn.now());
      table.unique(['team_id', 'world_name']); // A world can only be in a team's list once
      table.index(['team_id']);
      table.index(['world_name']);
      table.index(['expiry_date']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('team_worlds')
    .dropTableIfExists('team_invitations')
    .dropTableIfExists('team_members')
    .dropTableIfExists('teams');
};
