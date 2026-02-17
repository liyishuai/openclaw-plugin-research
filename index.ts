import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Type } from "@sinclair/typebox";

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
    await db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        project TEXT NOT NULL,
        tool TEXT NOT NULL,
        label TEXT NOT NULL,
        url TEXT,
        title TEXT,
        content_path TEXT,
        raw_json TEXT,
        extracted_text TEXT,
        is_curated INTEGER DEFAULT 0,
        tags TEXT
      )
    `);
    return db;
  }

  async function updateIndex() {
    const db = await getDb();
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
        tool: row.tool,
        label: row.label,
        url: row.url,
        title: row.title || row.label,
        file: row.content_path ? path.basename(row.content_path) : null,
        summary
      };
    });
    fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2));
    await db.close();
  }

  // Hook into tool results
  api.on("after_tool_call", async (event, ctx) => {
    if (event.toolName !== "web_search" && event.toolName !== "web_fetch") {
      return;
    }

    if (event.error) {
      return;
    }

    // Attempt to determine project from sessionKey or agentId
    // Default to 'global'
    let project = "global";
    if (ctx.sessionKey) {
      if (ctx.sessionKey.includes("white-album")) project = "white-album";
      else if (ctx.sessionKey.includes("euphonium")) project = "euphonium-vn";
    }

    const db = await getDb();
    const timestamp = new Date().toISOString();

    if (event.toolName === "web_search") {
      await db.run(`
        INSERT INTO entries (timestamp, project, tool, label, raw_json, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [timestamp, project, 'web_search', event.params.query, JSON.stringify(event.result), JSON.stringify([])]);
      api.logger.info(`[research-archive] Automatically logged search: ${event.params.query}`);
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
          INSERT INTO entries (timestamp, project, tool, label, url, title, content_path, raw_json, extracted_text, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [timestamp, project, 'web_fetch', res.url, res.url, res.title || 'No Title', filepath, JSON.stringify(res), res.text || '', JSON.stringify([])]);
        api.logger.info(`[research-archive] Automatically logged fetch: ${res.url}`);
      }
    }

    await db.close();
    await updateIndex();
  });

  // Tools
  api.registerTool({
    name: "research_find",
    description: "Search the unified research bank for existing findings.",
    parameters: Type.Object({
      query: Type.String({ description: "Search term" }),
      project: Type.Optional(Type.String({ description: "Filter by project" }))
    }),
    async execute(_id, params) {
      const db = await getDb();
      let sql = "SELECT * FROM entries WHERE label LIKE ? OR title LIKE ? OR extracted_text LIKE ?";
      const likeTerm = `%${params.query}%`;
      const sqlParams: any[] = [likeTerm, likeTerm, likeTerm];
      if (params.project) {
        sql += " AND project = ?";
        sqlParams.push(params.project);
      }
      sql += " ORDER BY timestamp DESC LIMIT 20";
      const rows = await db.all(sql, sqlParams);
      await db.close();
      
      const results = rows.map(r => ({
        id: r.id,
        project: r.project,
        tool: r.tool,
        title: r.title,
        label: r.label,
        timestamp: r.timestamp,
        preview: (r.extracted_text || '').substring(0, 200)
      }));

      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  });

  // Commands
  api.registerCommand({
    name: "research",
    description: "Search research archive",
    acceptsArgs: true,
    handler: async (ctx) => {
      const db = await getDb();
      const term = ctx.args?.trim() || "";
      const likeTerm = `%${term}%`;
      const rows = await db.all("SELECT id, project, tool, title, label, timestamp FROM entries WHERE label LIKE ? OR title LIKE ? OR extracted_text LIKE ? ORDER BY timestamp DESC LIMIT 10", [likeTerm, likeTerm, likeTerm]);
      await db.close();
      if (rows.length === 0) return { text: "No research found matching your query." };
      const output = rows.map(r => `[${r.id}] [${r.project}] ${r.tool}: ${r.title || r.label} (${r.timestamp})`).join('\n');
      return { text: `Found ${rows.length} entries:\n${output}` };
    }
  });
}
