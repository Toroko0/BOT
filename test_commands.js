
async function testAddWorld() {
    const { execute } = require('./commands/addworld.js');
    const interaction = {
        options: {
            getString: (option) => {
                if (option === 'world') return 'TESTWORLD';
                if (option === 'locktype') return 'mainlock';
                return null;
            },
            getInteger: (option) => {
                if (option === 'days') return 10;
                return null;
            }
        },
        user: {
            id: '12345',
            username: 'testuser'
        },
        guildId: '67890',
        reply: async (message) => {
            console.log('Reply:', message.content);
        }
    };
    await execute(interaction);
}

async function testList() {
    const { execute } = require('./commands/list.js');
    const interaction = {
        user: {
            id: '12345',
            tag: 'testuser#0000'
        },
        client: {},
        deferReply: async () => {},
        editReply: async (message) => {
            console.log('List command output:', message.content);
        },
        isMessageComponent: () => false,
        type: 0
    };
    await execute(interaction);
}

async function testRemove() {
    const { execute } = require('./commands/remove.js');
    const interaction = {
        options: {
            getString: (option) => {
                if (option === 'world') return 'TESTWORLD';
                return null;
            }
        },
        reply: async (message) => {
            console.log('Reply:', message.content);
        }
    };
    await execute(interaction);
}

setTimeout(async () => {
    await testAddWorld();
}, 2000);
