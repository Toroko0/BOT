# Growtopia Tracker Bot

A Discord bot to privately track Growtopia worlds, expiration dates, and more.

---

## Features

- Slash commands to add, list, remove, and search worlds
- Categories and usage examples in `/help`
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
git clone https://github.com/Torok0/BOT.git
cd BOT
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
| `/stats`       | View your world statistics           | `/stats`                                              |
| `/search`      | Filter worlds by prefix, lock, expiry| `/search prefix:BUY locktype:mainlock daysowned:7` |
| `/settings`    | Adjust your personal bot settings    | `/settings`                                           |
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
