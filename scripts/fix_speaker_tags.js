#!/usr/bin/env node
/**
 * fix_speaker_tags.js - Demote unidentified speaker WikiLinks to plain text
 *
 * Problem: otter_sync.js wrapped all Otter.ai speaker names in WikiLinks, including
 * unidentified ones like "Speaker 1", "Speaker 2", "Unknown Speaker". In Obsidian,
 * these create false graph connections — every [[Speaker 1]] across different meetings
 * looks like the same person.
 *
 * Fix: Replace "[[Speaker N]]" and "[[Unknown Speaker]]" with plain text (no brackets)
 * in the participants: frontmatter of all transcript files. Named people are unaffected.
 *
 * Usage:
 *   node fix_speaker_tags.js             # Apply fix to all transcript files
 *   node fix_speaker_tags.js --dry-run   # Preview changes without writing
 */

const fs   = require("fs");
const path = require("path");

// ── Config ─────────────────────────────────────────────────────────────────────
const SCRIPT_DIR      = __dirname;
const VAULT_ROOT      = path.join(SCRIPT_DIR, "..", "..");
const TRANSCRIPTS_DIR = path.join(VAULT_ROOT, "Transcripts");
const DRY_RUN         = process.argv.includes("--dry-run");

// Matches: "[[Speaker 1]]", "[[Speaker 12]]", "[[Unknown Speaker]]"
// Only in the quoted WikiLink form that otter_sync.js produces in frontmatter.
// Does NOT match named people like "[[William Walker]]".
const SPEAKER_LINK_RE = /"\[\[(Speaker \d+|Unknown Speaker)\]\]"/g;

// ── File walker ────────────────────────────────────────────────────────────────
function walkDir(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

// ── Process single file ────────────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  const updated  = original.replace(SPEAKER_LINK_RE, "$1");

  if (updated === original) return { changed: false, count: 0 };

  // Count replacements made
  const matches = [...original.matchAll(SPEAKER_LINK_RE)];
  if (!DRY_RUN) fs.writeFileSync(filePath, updated, "utf8");
  return { changed: true, count: matches.length };
}

// ── Main ───────────────────────────────────────────────────────────────────────
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
  console.error(`Transcripts directory not found: ${TRANSCRIPTS_DIR}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log("[DRY RUN] No files will be written.\n");
}

const files = walkDir(TRANSCRIPTS_DIR);
let changedFiles = 0;
let totalEntries = 0;

for (const file of files) {
  const { changed, count } = processFile(file);
  if (changed) {
    changedFiles++;
    totalEntries += count;
    const rel = path.relative(TRANSCRIPTS_DIR, file);
    console.log(`  ${DRY_RUN ? "[dry-run] " : ""}${rel}  (${count} entr${count === 1 ? "y" : "ies"})`);
  }
}

console.log(
  `\n${DRY_RUN ? "[DRY RUN] " : ""}Done: ${changedFiles} file${changedFiles === 1 ? "" : "s"} updated, ` +
  `${totalEntries} Speaker WikiLink${totalEntries === 1 ? "" : "s"} demoted to plain text.`
);
