#!/usr/bin/env node
/**
 * otter_sync.js - Sync Otter.ai transcripts from Dropbox to Obsidian AI Vault
 *
 * Usage:
 *   node otter_sync.js                        # Process new transcripts from Dropbox
 *   node otter_sync.js --all                  # Reprocess all (ignore processed log)
 *   node otter_sync.js --list                 # List available files without processing
 *   node otter_sync.js --local-dir "C:\path"  # Process TXT files from a local folder
 *
 * Reads token from:    ../config/dropbox.env
 * Writes transcripts:  ../../Transcripts/YYYY-MM/YYYY-MM-DD_Title.md
 * Tracks processed:    ../config/otter_processed.json
 */

const https = require("https");
const fs   = require("fs");
const path = require("path");

// ── Paths ──────────────────────────────────────────────────────────────────────
const SCRIPT_DIR      = __dirname;
const CONFIG_DIR      = path.join(SCRIPT_DIR, "..", "config");
const VAULT_ROOT      = path.join(SCRIPT_DIR, "..", "..");
const CONFIG_FILE     = path.join(CONFIG_DIR, "dropbox.env");
const PROCESSED_LOG   = path.join(CONFIG_DIR, "otter_processed.json");
const TRANSCRIPTS_DIR = path.join(VAULT_ROOT, "Transcripts");
const OTTER_FOLDER    = "/Apps/Otter";

// ── Dropbox API ────────────────────────────────────────────────────────────────

function loadToken() {
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`Config not found: ${CONFIG_FILE}`);
  const lines = fs.readFileSync(CONFIG_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DROPBOX_TOKEN=")) {
      return trimmed.slice("DROPBOX_TOKEN=".length).trim();
    }
  }
  throw new Error("DROPBOX_TOKEN not found in config file");
}

function dropboxRequest(token, { endpoint, body, downloadPath }) {
  return new Promise((resolve, reject) => {
    const isDownload = !!downloadPath;
    const hostname = isDownload ? "content.dropboxapi.com" : "api.dropboxapi.com";
    const urlPath  = `/2/${endpoint}`;

    const headers = { Authorization: `Bearer ${token}` };
    let postData;

    if (isDownload) {
      headers["Dropbox-API-Arg"] = JSON.stringify({ path: downloadPath });
      postData = "";
    } else {
      headers["Content-Type"] = "application/json";
      postData = body ? JSON.stringify(body) : "null";
      headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = https.request({ hostname, path: urlPath, method: "POST", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          return reject(new Error(`Dropbox ${res.statusCode}: ${buf.toString()}`));
        }
        resolve(isDownload ? buf.toString("utf8") : JSON.parse(buf.toString()));
      });
    });
    req.on("error", reject);
    if (postData !== undefined) req.write(postData);
    req.end();
  });
}

async function listOtterFiles(token) {
  const files = [];
  let result = await dropboxRequest(token, {
    endpoint: "files/list_folder",
    body: { path: OTTER_FOLDER, recursive: false },
  });
  while (true) {
    for (const entry of result.entries || []) {
      if (entry[".tag"] === "file" && entry.name.toLowerCase().endsWith(".txt")) {
        files.push(entry);
      }
    }
    if (!result.has_more) break;
    result = await dropboxRequest(token, {
      endpoint: "files/list_folder/continue",
      body: { cursor: result.cursor },
    });
  }
  return files;
}

async function downloadFile(token, dropboxPath) {
  return dropboxRequest(token, { endpoint: "files/download", downloadPath: dropboxPath });
}

// ── Parsing ────────────────────────────────────────────────────────────────────

// Matches: "Speaker Name  00:12" or "Speaker Name | Org  1:23:45"
const SPEAKER_RE = /^(.+?)\s{2,}(\d{1,2}:\d{2}(?::\d{2})?)$/;

function parseTranscript(content, filename) {
  // Extract date and title from filename: YYYY.MM.DD_Title.txt
  // Strip leading emoji / non-ASCII characters (e.g. Otter bulk export adds 📦)
  const stem = path.basename(filename, ".txt").replace(/^[^\x00-\x7F\w]+/, "").trim();
  let dateStr = "", title = stem;
  const dm = stem.match(/^(\d{4})\.(\d{2})\.(\d{2})[_ ](.+)$/);
  if (dm) {
    dateStr = `${dm[1]}-${dm[2]}-${dm[3]}`;
    title = dm[4].replace(/_/g, " ");
  }

  const segments = [];
  let currentSpeaker = null, currentTs = null, currentLines = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = line.match(SPEAKER_RE);
    if (m) {
      if (currentSpeaker && currentLines.length) {
        segments.push({ speaker: currentSpeaker, timestamp: currentTs, text: currentLines.join(" ").trim() });
      }
      currentSpeaker = m[1].trim();
      currentTs      = m[2].trim();
      currentLines   = [];
    } else if (line && currentSpeaker !== null) {
      currentLines.push(line);
    }
  }
  if (currentSpeaker && currentLines.length) {
    segments.push({ speaker: currentSpeaker, timestamp: currentTs, text: currentLines.join(" ").trim() });
  }

  // Unique participants (strip "| Org" suffix)
  const seen = new Set();
  const participants = [];
  for (const seg of segments) {
    const base = seg.speaker.replace(/\s*\|.*$/, "").trim();
    if (base && !seen.has(base)) { seen.add(base); participants.push(base); }
  }

  return {
    date: dateStr || new Date().toISOString().slice(0, 10),
    title,
    filename,
    participants,
    segments,
  };
}

function inferTags(title, participants) {
  const tags = ["transcript", "otter"];
  const t = title.toLowerCase();
  if (/1x1|one.on.one/.test(t))                         tags.push("1x1");
  if (/meeting|review|call|discussion/.test(t))          tags.push("meeting");
  if (/funnel|sourcing|procurement|vendor/.test(t))      tags.push("procurement");
  if (/traffic/.test(t))                                  tags.push("traffic-control");
  if (/safety|safe/.test(t))                              tags.push("safety");
  if (/invoice|invoic/.test(t))                           tags.push("invoicing");
  if (/logistic|freight|shipping/.test(t))                tags.push("logistics");
  if (/legal|msa|contract|agreement/.test(t))             tags.push("legal");
  if (/therapy|counseling|mental/.test(t))                tags.push("personal");
  if (/vicki/.test(t) || participants.some(p => /vicki/i.test(p))) tags.push("vicki");
  return tags;
}

function inferMeetingType(title) {
  const t = title.toLowerCase();
  if (/1x1|one.on.one/.test(t))                          return "1x1";
  if (/therapy|counseling|mental health/.test(t))         return "therapy";
  if (/estate|insurance|financial|tax/.test(t))           return "personal-finance";
  if (/relationship|marriage|family/.test(t))             return "personal";
  if (/vendor management|vendor|subcontract/.test(t))     return "vendor";
  if (/training|learning|onboard/.test(t))                return "training";
  if (/strategy|planning|workshop/.test(t))               return "strategy";
  if (/daily|debrief|standup|touchpoint/.test(t))         return "standup";
  if (/weekly|sourcing funnel|funnel review/.test(t))     return "weekly-review";
  if (/procurement|sourcing|ap /.test(t))                 return "procurement";
  if (/invoice|invoic/.test(t))                           return "invoice-management";
  if (/safety|incident/.test(t))                          return "safety";
  if (/legal|msa|contract/.test(t))                       return "legal";
  if (/company meeting|fireside|all.hand/.test(t))        return "all-hands";
  if (/meeting|review|call|discussion|session/.test(t))   return "meeting";
  return "other";
}

// ── Markdown formatting ────────────────────────────────────────────────────────

function formatAsMarkdown(data) {
  const { date, title, participants, segments, filename } = data;
  const tags        = inferTags(title, participants);
  const meetingType = inferMeetingType(title);

  const UNIDENTIFIED_RE = /^(Speaker \d+|Unknown Speaker)$/i;
  const partsYaml = participants.map(p =>
    UNIDENTIFIED_RE.test(p) ? `  - ${p}` : `  - "[[${p}]]"`
  ).join("\n");
  const tagsYaml  = tags.map(t => `  - ${t}`).join("\n");

  const lines = [
    "---",
    `date: ${date}`,
    `title: "${title}"`,
    "type: transcript",
    "source: otter",
    `meeting-type: ${meetingType}`,
    `participants:\n${partsYaml}`,
    `tags:\n${tagsYaml}`,
    "transcript: complete",
    "processed: false",
    `dropbox_source: "${filename}"`,
    "---",
    "",
    `# ${title}`,
    `*${date} — via Otter.ai*`,
    "",
    "## Overview",
    "<!-- Add summary here -->",
    "",
    "## Action Items",
    "<!-- Review transcript and extract action items -->",
    "",
    "## Transcript",
    "",
  ];

  let prevSpeaker = null;
  for (const seg of segments) {
    if (seg.speaker !== prevSpeaker) {
      if (prevSpeaker !== null) lines.push("");
      lines.push(`**${seg.speaker}** \`${seg.timestamp}\``);
      prevSpeaker = seg.speaker;
    }
    lines.push(seg.text);
  }

  return lines.join("\n");
}

// ── Output path ────────────────────────────────────────────────────────────────

function outputPathFor(data) {
  const year      = data.date.slice(0, 4);
  const yearMonth = data.date.slice(0, 7);
  const safeTitle = data.title.replace(/[\\/*?:"<>|]/g, "").replace(/\s+/g, " ").trim();
  const fname = `${data.date}_${safeTitle}.md`;
  const folder = path.join(TRANSCRIPTS_DIR, year, yearMonth);
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, fname);
}

// ── Processed log ──────────────────────────────────────────────────────────────

function loadProcessedLog() {
  if (fs.existsSync(PROCESSED_LOG)) return JSON.parse(fs.readFileSync(PROCESSED_LOG, "utf8"));
  return {};
}

function saveProcessedLog(log) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PROCESSED_LOG, JSON.stringify(log, null, 2));
}

// ── Local directory processing ─────────────────────────────────────────────────

function listLocalFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(".txt"))
    .map(name => ({
      name,
      id: `local:${name}`,  // stable key for processed log
      localPath: path.join(dir, name),
      size: fs.statSync(path.join(dir, name)).size,
    }));
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const reprocessAll = args.includes("--all");
  const listOnly     = args.includes("--list");
  const localDirIdx  = args.indexOf("--local-dir");
  const localDir     = localDirIdx !== -1 ? args[localDirIdx + 1] : null;

  let files;
  if (localDir) {
    console.log(`Reading local folder: ${localDir}`);
    files = listLocalFiles(localDir);
    console.log(`Found ${files.length} transcript(s) locally.\n`);
  } else {
    console.log("Loading Dropbox token...");
    const token = loadToken();
    console.log("Fetching file list from Dropbox /Apps/Otter...");
    files = await listOtterFiles(token);
    // Attach token for download step
    files = files.map(f => ({ ...f, _token: token }));
    console.log(`Found ${files.length} transcript(s) in Dropbox.\n`);
  }

  if (listOnly) {
    for (const f of files) console.log(`  ${f.name}  (${f.size.toLocaleString()} bytes)`);
    return;
  }

  const processed = loadProcessedLog();
  let newCount = 0, skipCount = 0, tinyCount = 0;

  for (const entry of files) {
    const { name, id, size } = entry;

    // Skip tiny files (under 100 bytes — empty or failed transcriptions)
    if (size < 100) {
      tinyCount++;
      continue;
    }

    if (!reprocessAll && processed[id]) {
      skipCount++;
      continue;
    }

    console.log(`Processing: ${name}`);
    try {
      let content;
      if (entry.localPath) {
        content = fs.readFileSync(entry.localPath, "utf8");
      } else {
        content = await downloadFile(entry._token, entry.path_display);
      }

      const data    = parseTranscript(content, name);
      const md      = formatAsMarkdown(data);
      const outPath = outputPathFor(data);
      fs.writeFileSync(outPath, md, "utf8");
      const rel = path.relative(VAULT_ROOT, outPath);
      console.log(`  → Written: ${rel}`);

      processed[id] = {
        name,
        processed_at: new Date().toISOString(),
        output: outPath,
      };
      newCount++;
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  saveProcessedLog(processed);
  console.log(`\nDone. ${newCount} processed, ${skipCount} skipped, ${tinyCount} empty/skipped.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
