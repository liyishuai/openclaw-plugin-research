# SKILL: Research Archive

You have access to a centralized, project-generic research database that automatically tracks all `web_search` and `web_fetch` activities across all projects.

## 📂 Database Details

- **Path**: `~/.openclaw/workspace/bank/research/research.db`
- **Tables**: `entries`
  - `id`: Primary key
  - `timestamp`: Record time
  - `project`: Project tag (e.g. `white-album`, `euphonium-vn`, `global`)
  - `tool`: Source tool (`web_search` or `web_fetch`)
  - `label`: Search query or URL
  - `title`: Page title
  - `content_path`: Path to saved Markdown file
  - `raw_json`: Original JSON result
  - `extracted_text`: Full page text (for `web_fetch`)
  - `tags`: JSON array of project tags

## 🏛 Usage Protocol

1. **Local-First Search**: Before performing a new `web_search`, query the local database using `sqlite3` via `exec`.
2. **Flexible Querying**: Use standard SQL to find relevant findings.
   - Example: `sqlite3 ~/.openclaw/workspace/bank/research/research.db "SELECT id, title, label FROM entries WHERE extracted_text LIKE '%lzss%'" -header -column`
3. **Markdown Recall**: If you find an entry with a `content_path`, read that file to get the full context.
4. **Automatic Logging**: The `@openclaw/research-archive` plugin is active and automatically handles logging for all future `web_search` and `web_fetch` calls.
