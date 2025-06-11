// YYYYMMDDHHMMSS_add_bio_to_users_table.js
exports.up = function(knex) {
  return knex.schema.table('users', function(table) {
    table.text('bio').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('users', function(table) {
    table.dropColumn('bio');
  });
};
