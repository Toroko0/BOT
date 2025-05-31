const cron = require('node-cron');
const db = require('../database.js'); // Adjust path as needed
const logger = require('../utils/logger.js'); // Adjust path as needed

let clientInstance; // Will hold the Discord client instance

// Function to check reminders
async function checkReminders() {
    logger.info('[Scheduler] Checking for due reminders...');
    try {
        const usersToRemind = await db.knex('users') // Using db.knex for direct query
            .where('reminder_enabled', true)
            .andWhereNot('reminder_time_utc', null)
            .select('id', 'username', 'reminder_time_utc');

        if (usersToRemind.length === 0) {
            logger.info('[Scheduler] No users with reminders enabled and time set.');
            return;
        }

        const nowUtc = new Date();
        const currentUtcHour = nowUtc.getUTCHours();
        const currentUtcMinute = nowUtc.getUTCMinutes();

        logger.debug(`[Scheduler] Current UTC time for comparison: ${String(currentUtcHour).padStart(2, '0')}:${String(currentUtcMinute).padStart(2, '0')}`);

        for (const user of usersToRemind) {
            const [reminderHour, reminderMinute] = user.reminder_time_utc.split(':').map(Number);

            // Simple check: if stored HH:MM matches current UTC HH:MM
            // More advanced: check if current time is within X minutes of reminder_time_utc
            // For a 5-minute cron, we want to catch any reminder that falls within this window.
            // Example: Cron runs at 10:00, 10:05, 10:10.
            // User reminder at 10:02. When cron runs at 10:05, it should pick it up.
            // This means the reminder time should be >= cron_last_run_time and < cron_current_run_time.
            // For simplicity now, let's check if the reminder time is within the current cron interval.
            // If cron runs every 5 mins, check if (reminderHour == currentUtcHour && reminderMinute >= currentUtcMinute - 4 && reminderMinute <= currentUtcMinute)
            // A simpler approach for now: just check for exact minute match for the cron run.
            // This means if cron runs at HH:00, HH:05, HH:10, it only catches reminders set exactly to HH:00, HH:05, HH:10.
            // For a more robust solution, the cron job should ideally run every minute.

            // Let's use a 5-minute window for now. Cron runs every 5 mins.
            // A reminder is due if its time is in the interval [current_time - 4min, current_time]
            // This handles reminders like HH:01, HH:02, HH:03, HH:04, HH:05 when cron runs at HH:05.

            // Calculate difference in minutes from current UTC time.
            const reminderTotalMinutes = reminderHour * 60 + reminderMinute;
            const currentTotalMinutes = currentUtcHour * 60 + currentUtcMinute;

            // Check if the reminder time was within the last 5 minutes (or exactly now)
            // This handles the case where the cron job might run slightly after the exact minute.
            let diff = currentTotalMinutes - reminderTotalMinutes;
            if (diff < 0) {
                diff += 1440; // Add a day in minutes if reminder time is "earlier" (e.g. reminder 23:58, current 00:01)
            }

            if (diff >= 0 && diff < 5) { // Cron interval is 5 minutes
                logger.info(`[Scheduler] User ${user.username} (ID: ${user.id}) is due for a reminder at ${user.reminder_time_utc} UTC.`);

                // Fetch worlds at their lifecycle end (expiring today UTC)
                logger.info(`[Scheduler] Fetching worlds at lifecycle end (expiry today UTC) for user ${user.username} (ID: ${user.id}).`);
                const lifecycleEndWorlds = await db.getWorldsAtLifecycleEnd(user.id);

                if (lifecycleEndWorlds && lifecycleEndWorlds.length > 0) {
                    let messageContent = "Hello! The following worlds have reached 180 days owned:\n"; // Message remains the same
                    for (const world of lifecycleEndWorlds) {
                        messageContent += `- ${world.name}${world.custom_id ? ' (' + world.custom_id + ')' : ''}\n`;
                    }
                    messageContent += "\nPlease check your list for more details.";

                    try {
                        if (!clientInstance) {
                            logger.error('[Scheduler] clientInstance is not available for sending DM.');
                            continue; // Skip if client is not set
                        }
                        await clientInstance.users.send(user.id, messageContent);
                        logger.info(`[Scheduler] Successfully sent lifecycle end reminder DM to ${user.username} (ID: ${user.id}) for ${lifecycleEndWorlds.length} world(s).`);
                    } catch (dmError) {
                        logger.error(`[Scheduler] Failed to send reminder DM to ${user.username} (ID: ${user.id}). Error: ${dmError.message}`);
                        if (dmError.code === 50007) { // Discord error code for "Cannot send messages to this user"
                            logger.warn(`[Scheduler] User ${user.username} (ID: ${user.id}) may have DMs disabled or has blocked the bot.`);
                        }
                    }
                } else {
                    logger.info(`[Scheduler] User ${user.username} (ID: ${user.id}) is due for a reminder, but no worlds found expiring today UTC.`);
                }
            }
        }
    } catch (error) {
        logger.error('[Scheduler] Error checking reminders:', error);
    }
}

// Schedule the job. Using '*/5 * * * *' for every 5 minutes.
// For more precise timing (e.g. to catch all HH:MM), cron should run every minute ('* * * * *').
// If running every minute, the diff check should be `diff === 0`.
// Given the plan says "every 5 minutes", the diff check `diff >= 0 && diff < 5` is appropriate.
const task = cron.schedule('*/5 * * * *', checkReminders, {
    scheduled: false // Don't start immediately, allow explicit start
});

function start(discordClient) {
    if (!discordClient) {
        logger.error('[Scheduler] Discord client object is required to start.');
        return;
    }
    clientInstance = discordClient; // Store the client instance
    logger.info('[Scheduler] Starting reminder scheduler, client instance received.');
    checkReminders(); // Run once on start
    task.start();
}

function stop() {
    logger.info('[Scheduler] Stopping reminder scheduler.');
    task.stop();
}

module.exports = {
    start,
    stop,
    checkReminders // Expose for potential manual trigger or testing
};
