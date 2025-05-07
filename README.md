# Growtopia Tracker Bot

A Discord bot to privately track Growtopia worlds, expiration dates, sharing, and more.

---

## Features

- Slash commands to add, list, remove, share, unshare, and search worlds
- Unique share links with optional expiration
- World expiration tracking and reminders
- Categories and usage examples in `/help`
- Admin commands with permission checks
- Audit logs of all actions
- CI/CD pipeline with GitHub Actions
- Dockerized deployment
- SQLite database with migrations
- Multi-language support ready (i18n)
- Accessibility-friendly UI

---

## Setup

1. Clone the repo:

```bash
git clone https://github.com/yourname/growtopia-tracker-bot.git
cd growtopia-tracker-bot
```

2. Install dependencies:

```bash
npm install
```

3. Configure `.env`:

```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-client-id
```

4. Run database migrations:

```bash
npx knex migrate:latest
```

5. Start the bot:

```bash
node index.js
```

---

## Commands

| Command        | Description                          | Example Usage                                         |
|----------------|--------------------------------------|-------------------------------------------------------|
| `/addworld`    | Add a world                          | `/addworld world:MYWORLD days:10 locktype:mainlock`   |
| `/list`        | List your worlds                     | `/list`                                               |
| `/info`        | Detailed info about a world          | `/info world:MYWORLD`                                 |
| `/remove`      | Remove a world                       | `/remove world:MYWORLD`                               |
| `/share`       | Generate a share link                | `/share world_name:MYWORLD`                           |
| `/unshare`     | Make a world private again           | `/unshare world_name:MYWORLD`                         |
| `/stats`       | View your world statistics           | `/stats`                                              |
| `/search`      | Filter worlds by prefix, lock, expiry| `/search prefix:BUY locktype:mainlock expiringdays:7` |
| `/sync`        | Refresh slash commands (admin only)  | `/sync`                                               |
| `/help`        | Show help and onboarding info        | `/help`                                               |

---

## Screenshots

_Add screenshots of the bot in action here._

---

## Contributing

- Fork the repo
- Create a feature branch (`git checkout -b feature/my-feature`)
- Follow existing code style (async/await, modular)
- Add tests if possible
- Submit a pull request with a clear description

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## License

MIT
