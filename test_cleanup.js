const assert = require('assert');
const db = require('./database.js');

async function runTests() {
    // Add some test worlds
    const now = new Date();
    const expiredDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const futureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days from now

    await db.addWorld('EXPIREDWORLD', 180, 'mainlock', null, 'testuser');
    await db.addWorld('FUTUREWORLD', 178, 'mainlock', null, 'testuser');

    // Manually set the expiry dates for testing
    await db.knex('worlds').where({ name: 'EXPIREDWORLD' }).update({ expiry_date: expiredDate.toISOString() });
    await db.knex('worlds').where({ name: 'FUTUREWORLD' }).update({ expiry_date: futureDate.toISOString() });

    // Run the cleanup function
    await db.removeExpiredWorlds();

    // Check that the expired world is gone
    const expiredWorld = await db.getWorldByName('EXPIREDWORLD');
    assert.strictEqual(expiredWorld, null, 'Test Case 1 Failed: Expired world should have been deleted.');
    console.log('Test Case 1 Passed: Expired world was deleted.');

    // Check that the future world still exists
    const futureWorld = await db.getWorldByName('FUTUREWORLD');
    assert.notStrictEqual(futureWorld, null, 'Test Case 2 Failed: Future world should not have been deleted.');
    console.log('Test Case 2 Passed: Future world was not deleted.');

    // Clean up the test data
    await db.removeWorld(futureWorld.id);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
}).finally(() => {
    db.knex.destroy();
});
