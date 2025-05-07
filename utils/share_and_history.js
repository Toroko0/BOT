const db = require('../database.js'); // Use the Knex instance from database.js
const logger = require('../utils/logger.js'); // Use the logger

// Note: Share link functionality seems unused by current commands, keeping for potential future use.

// Create a new share link
async function createShareLink(worldId, expiresAt = null) {
  try {
    // Generate a unique token (example, consider a more robust method like crypto)
    const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

    const result = await db.knex('share_links').insert({
      world_id: worldId,
      token: token,
      expires_at: expiresAt // Knex handles date formatting
    }).returning('token'); // Get the token back

    if (result && result.length > 0) {
        return result[0].token || token; // Return the generated token
    } else {
         // This case might happen with some DB drivers, fallback to generated token
         logger.warn(`[share_and_history] Share link insert did not return token for world ${worldId}`);
         return token;
    }
  } catch (error) {
    logger.error('[share_and_history] Error creating share link:', error);
    throw error; // Re-throw error to be handled by caller
  }
}

// Retrieve share link info by token
async function getShareLinkByToken(token) {
  try {
    const link = await db.knex('share_links')
      .where({ token: token })
      .first(); // Get single record or undefined
    return link || null; // Return null if not found
  } catch (error) {
    logger.error('[share_and_history] Error fetching share link by token:', error);
    throw error;
  }
}

// Log an action in history
async function logHistory(worldId, userId, action, details = null) {
  try {
    await db.knex('history').insert({
      world_id: worldId,
      user_id: userId,
      action: action,
      details: details
      // timestamp is handled by DEFAULT CURRENT_TIMESTAMP
    });
    logger.debug(`[History] Logged action: ${action} for world ${worldId}, user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`[share_and_history] Error logging history (Action: ${action}, World: ${worldId}, User: ${userId}):`, error);
    // Decide whether to throw or just return false
    return false; // Return false indicating failure
  }
}

module.exports = {
  createShareLink,
  getShareLinkByToken,
  logHistory
};