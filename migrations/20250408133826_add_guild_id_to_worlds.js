/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('worlds', function(table) {
    // Add guild_id column to track where a world is shared publicly
    table.string('guild_id').nullable().comment('Discord Guild ID where world is public');
    // Add index for faster lookup of public worlds in a specific guild
    table.index(['is_public', 'guild_id'], 'idx_worlds_public_guild');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('worlds', function(table) {
    // Drop the index first
    table.dropIndex(['is_public', 'guild_id'], 'idx_worlds_public_guild');
    // Then drop the column
    table.dropColumn('guild_id');
  });
};
