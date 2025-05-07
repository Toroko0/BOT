const fs = require('fs');
const path = require('path');
const util = require('util'); // For formatting objects/errors

// Ensure logs directory exists
const logDir = path.join(__dirname, '..', 'logs'); // Changed directory name
if (!fs.existsSync(logDir)) {
  try {
      fs.mkdirSync(logDir);
  } catch (err) {
      console.error("FATAL: Could not create logs directory.", err);
      // Fallback or exit? For now, console logging will still work.
  }
}

const logFilePath = path.join(logDir, 'bot.log');
const stream = fs.createWriteStream(logFilePath, { flags: 'a' });

function formatMessage(level, ...args) {
  // Use util.format for better object/error formatting
  const messageContent = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
        // Handle errors specifically for better stack trace output
        if (arg instanceof Error) {
            return arg.stack || arg.message;
        }
        // Format other objects
        try {
            return util.inspect(arg, { depth: 4, colors: false }); // Adjust depth as needed
        } catch {
             return '[Unformattable Object]';
        }
    }
    return arg;
  }).join(' ');
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${messageContent}\n`;
}

function log(level, ...args) {
    const formatted = formatMessage(level, ...args);
    // Log to console
    if (level === 'error') console.error(formatted.trim());
    else if (level === 'warn') console.warn(formatted.trim());
    else console.log(formatted.trim());

    // Log to file
    stream.write(formatted);
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  debug: (...args) => log('debug', ...args), // Added debug level
  log: log // Expose base log function if needed
};

// Optional: Handle stream errors
stream.on('error', (err) => {
  console.error('Error writing to log file:', err);
});