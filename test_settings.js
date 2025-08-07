const { handleButton, handleModal } = require('./commands/settings.js');
const db = require('./database.js');

// Mock the database functions
let dbStore = {};
db.getUserPreferences = async (userId) => {
    return dbStore[userId] || { timezone_offset: 0.0, view_mode: 'pc' };
};
db.updateUserTimezone = async (userId, timezoneOffset) => {
    if (!dbStore[userId]) {
        dbStore[userId] = { timezone_offset: 0.0, view_mode: 'pc' };
    }
    dbStore[userId].timezone_offset = timezoneOffset;
    return true;
};
db.updateUserViewMode = async (userId, viewMode) => {
    if (!dbStore[userId]) {
        dbStore[userId] = { timezone_offset: 0.0, view_mode: 'pc' };
    }
    dbStore[userId].view_mode = viewMode;
    return true;
};

// Mock the discord.js interaction objects
const mockInteraction = {
    user: { id: '12345' },
    showModal: () => {},
    reply: () => {},
    update: () => {},
    fields: {
        getTextInputValue: (customId) => {
            if (customId === 'timezone_offset') {
                return '5.5';
            }
        },
    },
    customId: 'settings_modal_timezone',
};

async function runTests() {
    // Test handleButton
    await handleButton(mockInteraction, ['timezone']);

    // Test handleModal with valid input
    await handleModal(mockInteraction);
    let prefs = await db.getUserPreferences('1234is_public');
    if (prefs.timezone_offset !== 5.5) {
        console.error('Test Case 1 Failed: Timezone offset should be 5.5');
        process.exit(1);
    }

    // Test handleModal with invalid input
    const invalidInteraction = {
        ...mockInteraction,
        fields: {
            getTextInputValue: () => 'invalid',
        },
    };
    await handleModal(invalidInteraction);
    prefs = await db.getUserPreferences('12345');
    if (prefs.timezone_offset === 'invalid') {
        console.error('Test Case 2 Failed: Timezone offset should not have changed.');
        process.exit(1);
    }

    // Test handleModal with out-of-range input
    const outOfRangeInteraction = {
        ...mockInteraction,
        fields: {
            getTextInputValue: () => '20',
        },
    };
    await handleModal(outOfRangeInteraction);
    prefs = await db.getUserPreferences('12345');
    if (prefs.timezone_offset === 20) {
        console.error('Test Case 3 Failed: Timezone offset should not have changed.');
        process.exit(1);
    }

    console.log('All tests passed!');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
