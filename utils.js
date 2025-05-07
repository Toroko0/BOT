const { formatDistance, addDays } = require('date-fns');
const { table } = require('table');

// Calculate days until expiration (180 - days_owned)
function calculateDaysLeft(daysOwned) {
  // Ensure daysOwned is treated as a number and use simple formula: 180 - daysOwned
  const owned = parseInt(daysOwned) || 0;
  return Math.max(0, 180 - owned);
}

// Calculate expiration date based on days owned
function calculateExpiryDate(daysOwned) {
  const daysLeft = calculateDaysLeft(daysOwned);
  return addDays(new Date(), daysLeft);
}



// Get the day of week for a date
function getDayOfWeek(date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

// Format a world as a string for display
function formatWorld(world) {
  const daysLeft = calculateDaysLeft(world.days_owned);
  const expiryDate = calculateExpiryDate(world.days_owned);
  
  return {
    name: world.name,
    daysOwned: world.days_owned,
    daysLeft: daysLeft,
    expiryDate: formatDate(expiryDate),
    expiryDay: getDayOfWeek(expiryDate),
    lockType: world.lock_type || 'M',
    isPublic: world.is_public ? 'Public' : 'Private',
    addedBy: world.added_by
  };
}

// Format a list of worlds as a table
function formatWorldsTable(worlds, includePublicStatus = false) {
  if (worlds.length === 0) {
    return 'No worlds found.';
  }

  // Define table headers
  let headers = ['World', 'Days Owned', 'Days Left', 'Expires On', 'Lock Type'];
  if (includePublicStatus) {
    headers.push('Visibility');
  }

  // Format table data
  const data = [headers];
  worlds.forEach(world => {
    const formatted = formatWorld(world);
    let row = [
      formatted.name,
      formatted.daysOwned.toString(),
      formatted.daysLeft.toString(),
      `${formatted.expiryDate} (${formatted.expiryDay})`,
      formatted.lockType
    ];
    if (includePublicStatus) {
      row.push(formatted.isPublic);
    }
    data.push(row);
  });

  // Configure table options
  const config = {
    columns: {
      0: { alignment: 'left' },
      1: { alignment: 'right' },
      2: { alignment: 'right' },
      3: { alignment: 'left' },
      4: { alignment: 'left' },
    },
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼'
    },
    header: {
      alignment: 'center',
      content: 'Growtopia Worlds Tracker',
    }
  };

  if (includePublicStatus) {
    config.columns[5] = { alignment: 'left' };
  }

  return '```\n' + table(data, config) + '\n```';
}

// Format world details for the info command
function formatWorldDetails(world) {
  if (!world) {
    return 'World not found.';
  }

  const formatted = formatWorld(world);

  return `
**World Information: ${formatted.name}**

🌐 **Basic Details**
• Days Owned: ${formatted.daysOwned}
• Days Left: ${formatted.daysLeft}
• Expires On: ${formatted.expiryDate} (${formatted.expiryDay})
• Lock Type: ${formatted.lockType}

📊 **Tracking Info**
• Added By: ${formatted.addedBy}
• Visibility: ${formatted.isPublic}
• ID: ${world.id}
  `;
}

// Format world statistics
function formatWorldStats(stats) {
  if (!stats) {
    return 'No statistics available.';
  }

  // Format letter count distribution
  let letterCountText = '';
  Object.keys(stats.letterCounts).sort((a, b) => a - b).forEach(length => {
    letterCountText += `• ${length} letters: ${stats.letterCounts[length]} worlds\n`;
  });
  if (!letterCountText) letterCountText = '• No data\n';

  return `
**World Statistics**

📊 **Totals**
• Total Worlds: ${stats.totalWorlds}
• Private Worlds: ${stats.privateWorlds}
• Public Worlds: ${stats.publicWorlds}
• Expiring Soon (7 days): ${stats.expiringWorlds}

📏 **Name Lengths**
${letterCountText}
🔒 **Lock Types**
• M (mainlock): ${stats.Mainlock || 0} worlds
• O (outlock): ${stats.Outlock || 0} worlds

⏱️ **Ownership**
• Average Days Owned: ${stats.averageDaysOwned || 0} days
  `;
}

// Create cooldown for buttons to prevent spam
const cooldowns = new Map();

// Cooldown system to prevent command spam
function checkCooldown(userId, command, cooldownTime = 3) {
  const now = Date.now();
  const key = `${userId}-${command}`;
  const cooldownInfo = cooldowns.get(key);

  // Check if command is on cooldown
  if (cooldownInfo && cooldownInfo.expirationTime > now) {
    const timeLeft = Math.ceil((cooldownInfo.expirationTime - now) / 1000);
    return { onCooldown: true, timeLeft };
  }

  // Add cooldown
  cooldowns.set(key, {
    expirationTime: now + cooldownTime * 1000
  });

  return { onCooldown: false };
}

// Format date as MM/DD/YYYY
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
}

// Calculate days remaining until expiry
function calculateDaysRemaining(expiryDate) {
  const today = new Date();
  const diff = expiryDate.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Generate a colorful status for days left
function getDaysLeftStatus(daysLeft) {
  if (daysLeft <= 0) {
    return '🔴 EXPIRED';
  } else if (daysLeft <= 7) {
    return `🟠 ${daysLeft} DAYS LEFT`;
  } else if (daysLeft <= 30) {
    return `🟡 ${daysLeft} DAYS LEFT`;
  } else {
    return `🟢 ${daysLeft} DAYS LEFT`;
  }
}

// Get the day name of a date
function getDayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}



// Update all worlds' days by 1 in UTC-5 timezone
function updateWorldsDaily(db) {
  try {
    // Get the current date in UTC-5 timezone
    const now = new Date();
    // Convert to UTC-5 (Eastern Time)
    const utcMinus5Date = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    
    console.log(`[Daily Update] Starting daily world update at ${utcMinus5Date.toISOString()}`);
    
    return db.updateAllWorldDays()
      .then(result => {
        console.log(`[Daily Update] Successfully updated ${result} worlds`);
        return result;
      })
      .catch(err => {
        console.error('[Daily Update] Error updating world days:', err);
        return 0;
      });
  } catch (error) {
    console.error('[Daily Update] Unexpected error:', error);
    return 0;
  }
}

// Remove worlds older than 180 days
// Remove worlds older than 180 days
function removeExpiredWorlds(db) {
  try {
    console.log('[Cleanup] Starting expired worlds cleanup');

    return db.removeExpiredWorlds()
      .then(result => {
        console.log(`[Cleanup] Successfully removed ${result} expired worlds`);
        return result;
      })
      .catch(err => {
        console.error('[Cleanup] Error removing expired worlds:', err);
        return 0;
      });
  } catch (error) {
    console.error('[Cleanup] Unexpected error:', error);
    return 0;
  }
}

const formatWorldData = (world) => {
  return {
    name: world.name.toUpperCase(),
    daysOwned: world.days_owned || 0,
    expiryDate: world.expiry_date || new Date().toISOString(),
    lockType: world.lock_type || 'M',
    isPublic: world.is_public || false,
    customId: world.custom_id ? world.custom_id.toUpperCase() : null,
    addedBy: world.added_by || null
  };
};

const formatStats = (stats) => {
  return `📊 **World Statistics**
• Total Worlds: ${stats.total || 0}
• Public Worlds: ${stats.public || 0}
• Private Worlds: ${stats.private || 0}
• Lock Types:
  • M (mainlock): ${stats.mainlock || 0} worlds
  • O (outlock): ${stats.outlock || 0} worlds
• Expiring Soon: ${stats.expiringSoon || 0}
• Expired: ${stats.expired || 0}`;
};

module.exports = {
  calculateDaysLeft,
  calculateDaysRemaining,
  calculateExpiryDate,
  formatDate,
  getDayOfWeek,
  formatWorld,
  formatWorldsTable,
  formatWorldDetails,
  formatWorldStats,
  checkCooldown,
  updateWorldsDaily,
  removeExpiredWorlds
};
