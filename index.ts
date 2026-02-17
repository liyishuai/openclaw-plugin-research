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
    return await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
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

    let project = "global";
    if (ctx.sessionKey) {
      if (ctx.sessionKey.includes("white-album")) project = "white-album";
      else if (ctx.sessionKey.includes("euphonium")) project = "euphonium-vn";
    }

    try {
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
    } catch (err) {
      api.logger.error(`[research-archive] Hook failed: ${err.message}`);
    }
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
      try {
        let sql = "SELECT * FROM entries WHERE label LIKE ? OR title LIKE ? OR extracted_text LIKE ?";
        const likeTerm = `%${params.query}%`;
        const sqlParams: any[] = [likeTerm, likeTerm, likeTerm];
        if (params.project) {
          sql += " AND project = ?";
          sqlParams.push(params.project);
        }
        sql += " ORDER BY timestamp DESC LIMIT 20";
        const rows = await db.all(sql, sqlParams);
        
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
      } finally {
        await db.close();
      }
    }
  });
}
