# SKILL: Research Archive

You have access to a centralized, project-generic research database. This database automatically tracks all your `web_search` and `web_fetch` activities across all projects.

## 🛠 Tools

- `research_find(query, project?)`: Use this tool to search the historical research bank. Before performing a new `web_search`, always check the bank first to see if relevant information has already been gathered.

## 🤖 Automatic Logging

The `@openclaw/research-archive` plugin is active. It automatically hooks into your research tools:
- **`web_search`**: Results are logged to the database.
- **`web_fetch`**: Page content is saved as Markdown in the archive and logged to the database.

## 📂 Database Structure

- **Path**: `~/.openclaw/workspace/bank/research/research.db`
- **Tables**: `entries` (id, timestamp, project, tool, label, url, title, content_path, raw_json, extracted_text, tags)

## 🏛 Usage Protocol

1. **Local-First Search**: Always call `research_find` before `web_search`.
2. **Context Awareness**: Use the `project` field to filter results if necessary, but remember that research from other projects might be relevant (especially technical facts like `lzss` or `planar graphics`).
3. **Citations**: When using information found via `research_find`, mention that it was retrieved from the research bank.
