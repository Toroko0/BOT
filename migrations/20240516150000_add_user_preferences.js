exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.float('timezone_offset').defaultTo(0.0); // Default to UTC
    table.string('view_mode').defaultTo('pc'); // Default to 'pc'
    table.boolean('reminder_enabled').defaultTo(false);
    table.string('reminder_time_utc'); // Format HH:MM, nullable
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('timezone_offset');
    table.dropColumn('view_mode');
    table.dropColumn('reminder_enabled');
    table.dropColumn('reminder_time_utc');
  });
};
