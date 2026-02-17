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
    const entries = rows.map(row => ({
      timestamp: row.timestamp,
      project: row.project,
      tool: row.tool,
      label: row.label,
      url: row.url,
      title: row.title || row.label,
      file: row.content_path ? path.basename(row.content_path) : null,
      summary: row.tool === 'web_search' ? JSON.parse(row.raw_json || '{}') : {
        title: row.title,
        preview: (row.extracted_text || '').substring(0, 1000)
      }
    }));
    fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2));
    await db.close();
  }

  // Tools
  api.registerTool({
    name: "research_log_search",
    description: "Log a web search query and its results to the central research bank.",
    parameters: Type.Object({
      project: Type.String({ description: "Project name (e.g. white-album, euphonium-vn)" }),
      query: Type.String({ description: "The search query used" }),
      results: Type.Any({ description: "JSON results from the search tool" }),
      tags: Type.Optional(Type.Array(Type.String()))
    }),
    async execute(_id, params) {
      const db = await getDb();
      await db.run(`
        INSERT INTO entries (timestamp, project, tool, label, raw_json, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [new Date().toISOString(), params.project, 'web_search', params.query, JSON.stringify(params.results), JSON.stringify(params.tags || [])]);
      await db.close();
      await updateIndex();
      return { content: [{ type: "text", text: `Logged search for query: ${params.query}` }] };
    }
  });

  api.registerTool({
    name: "research_log_fetch",
    description: "Log a web fetch (crawled page) to the central research bank.",
    parameters: Type.Object({
      project: Type.String({ description: "Project name" }),
      url: Type.String({ description: "URL of the page" }),
      title: Type.String({ description: "Title of the page" }),
      text: Type.String({ description: "Extracted markdown/text content" }),
      raw_result: Type.Any({ description: "Full raw result from the fetch tool" }),
      tags: Type.Optional(Type.Array(Type.String()))
    }),
    async execute(_id, params) {
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
      const slug = params.url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const filename = `fetch_${Date.now()}_${slug}.md`;
      const filepath = path.join(downloadsDir, filename);
      fs.writeFileSync(filepath, `# ${params.title}\nURL: ${params.url}\n\n${params.text}`);

      const db = await getDb();
      await db.run(`
        INSERT INTO entries (timestamp, project, tool, label, url, title, content_path, raw_json, extracted_text, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [new Date().toISOString(), params.project, 'web_fetch', params.url, params.url, params.title, filepath, JSON.stringify(params.raw_result), params.text, JSON.stringify(params.tags || [])]);
      await db.close();
      await updateIndex();
      return { content: [{ type: "text", text: `Logged fetch for URL: ${params.url} -> ${filename}` }] };
    }
  });

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
      sql += " ORDER BY timestamp DESC";
      const rows = await db.all(sql, sqlParams);
      await db.close();
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
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
