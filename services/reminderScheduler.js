const cron = require('node-cron');
const db = require('../database.js');
const logger = require('../utils/logger.js');

function start(client) {
    // Schedule a task to run every minute
    cron.schedule('* * * * *', async () => {
        logger.info('[Scheduler] Checking for due reminders...');
        try {
            const now = new Date();
            const currentUtcTime = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;

            const usersToRemind = await db.knex('users')
                .where({
                    reminder_enabled: true,
                    reminder_time_utc: currentUtcTime,
                });

            for (const user of usersToRemind) {
                const expiringWorlds = await db.getExpiringWorldsForUser(user.id, 7);
                if (expiringWorlds.length > 0) {
                    const userDM = await client.users.fetch(user.id);
                    let message = `**Reminder:** You have worlds expiring within the next 7 days:\n`;
                    expiringWorlds.forEach(world => {
                        const expiryDate = new Date(world.expiry_date);
                        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                        message += `- **${world.name}** (expires in ${daysLeft} days)\n`;
                    });
                    await userDM.send(message);
                }
            }
        } catch (error) {
            logger.error('[Scheduler] Error checking reminders:', error);
        }
    });
}

module.exports = { start };
