import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';
import path from 'path';
import fs from 'fs';

export default function(api) {
  const config = api.config.plugins?.entries?.["research-archive"]?.config || {};
  const dbPath = path.resolve(os.homedir(), config.dbPath || '.openclaw/workspace/bank/research/research.db');
  const downloadsDir = path.resolve(os.homedir(), config.downloadsDir || '.openclaw/workspace/bank/research/downloads');
  const indexPath = path.join(path.dirname(dbPath), 'index.json');

  async function getDb() {
    if (!fs.existsSync(path.dirname(dbPath))) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Initialize schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        project TEXT,
        session_key TEXT,
        tool TEXT,
        label TEXT,
        url TEXT,
        title TEXT,
        content_path TEXT,
        raw_json TEXT,
        extracted_text TEXT,
        tags TEXT
      )
    `);
    
    return db;
  }

  async function updateIndex() {
    const db = await getDb();
    try {
      const rows = await db.all("SELECT * FROM entries ORDER BY timestamp DESC");
      const entries = rows.map(row => {
        let summary = {};
        try {
          if (row.tool === 'web_search') {
            summary = JSON.parse(row.raw_json || '{}');
          } else {
            summary = {
              title: row.title,
              preview: (row.extracted_text || '').substring(0, 1000)
            };
          }
        } catch (e) {
          summary = { error: "Failed to parse raw_json" };
        }
        
        return {
          timestamp: row.timestamp,
          project: row.project,
          session_key: row.session_key,
          tool: row.tool,
          label: row.label,
          url: row.url,
          title: row.title || row.label,
          file: row.content_path ? path.basename(row.content_path) : null,
          summary
        };
      });
      fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2));
    } finally {
      await db.close();
    }
  }

  // Hook into tool results
  api.on("after_tool_call", async (event, ctx) => {
    if (event.toolName !== "web_search" && event.toolName !== "web_fetch") {
      return;
    }

    if (event.error) {
      return;
    }

    // Generic project detection: use label or default to 'global'
    const project = ctx.label || "global";
    const session_key = ctx.sessionKey || "unknown";

    try {
      const db = await getDb();
      const timestamp = new Date().toISOString();

      if (event.toolName === "web_search") {
        await db.run(`
          INSERT INTO entries (timestamp, project, session_key, tool, label, raw_json, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [timestamp, project, session_key, 'web_search', event.params.query, JSON.stringify(event.result), JSON.stringify([])]);
      } 
      else if (event.toolName === "web_fetch") {
        const res = event.result as any;
        if (res && res.url) {
          if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
          }
          const slug = res.url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
          const filename = `fetch_${Date.now()}_${slug}.md`;
          const filepath = path.join(downloadsDir, filename);
          fs.writeFileSync(filepath, `# ${res.title || 'No Title'}\nURL: ${res.url}\n\n${res.text || ''}`);

          await db.run(`
            INSERT INTO entries (timestamp, project, session_key, tool, label, url, title, content_path, raw_json, extracted_text, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [timestamp, project, session_key, 'web_fetch', res.url, res.url, res.title || 'No Title', filepath, JSON.stringify(res), res.text || '', JSON.stringify([])]);
        }
      }
      await db.close();
      await updateIndex();
    } catch (err) {
      api.logger.error(`[research-archive] Hook processing failed: ${err.message}`);
    }
  });
}
