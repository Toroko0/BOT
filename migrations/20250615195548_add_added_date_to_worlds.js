exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('worlds', 'added_date');
  if (!hasColumn) {
    await knex.schema.table('worlds', function(table) {
      table.timestamp('added_date').defaultTo(knex.fn.now());
    });
    console.log('[Migration] Added added_date column to worlds table.');
  } else {
    console.log('[Migration] Column added_date already exists in worlds table. Skipping.');
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('worlds', 'added_date');
  if (hasColumn) {
    // Only drop the column if you are sure this specific migration added it
    // and it's safe to remove. For this specific issue, the column *should* exist.
    // Consider if dropping is always the right action for 'down'.
    // await knex.schema.table('worlds', function(table) {
    //   table.dropColumn('added_date');
    // });
    // console.log('[Migration] Dropped added_date column from worlds table. (If it was safe to do so)');
    console.log('[Migration] Down: added_date column was potentially present. No changes made by this down migration to preserve data if column was pre-existing from init_schema.');
  } else {
    console.log('[Migration] Down: Column added_date does not exist in worlds table. Nothing to do.');
  }
};
