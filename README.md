# OpenClaw Plugin: Research Archive

Centralized project-generic research database for OpenClaw.

## Features

- **Centralized Logging**: Tools to log `web_search` and `web_fetch` results to a single SQLite database.
- **Cross-Project Discovery**: Tag and search research across all projects.
- **Unified Web UI**: Automatically maintains an `index.json` manifest for the research archive viewer.
- **CLI Search**: `/research <query>` command to find entries quickly.

## Installation

```bash
openclaw plugins install https://github.com/liyishuai/openclaw-plugin-research
```

## Configuration

```json
{
  "plugins": {
    "entries": {
      "research-archive": {
        "enabled": true,
        "config": {
          "dbPath": ".openclaw/workspace/bank/research/research.db",
          "downloadsDir": ".openclaw/workspace/bank/research/downloads"
        }
      }
    }
  }
}
```

## Tools

- `research_log_search`: Log search results.
- `research_log_fetch`: Log crawled pages (saves as Markdown).
- `research_find`: Search the bank for existing facts.
