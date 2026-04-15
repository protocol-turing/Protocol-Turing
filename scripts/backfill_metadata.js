#!/usr/bin/env node
/**
 * backfill_metadata.js - Backfill meeting-type and processed fields on existing transcripts
 *
 * Usage:
 *   node backfill_metadata.js           # Dry run (shows counts, no changes)
 *   node backfill_metadata.js --write   # Apply changes to all transcripts
 *   node backfill_metadata.js --write --verbose  # Apply + show each file changed
 */

const fs   = require("fs");
const path = require("path");

const SCRIPT_DIR      = __dirname;
const VAULT_ROOT      = path.join(SCRIPT_DIR, "..", "..");
const TRANSCRIPTS_DIR = path.join(VAULT_ROOT, "Transcripts");

// ── Same logic as otter_sync.js ────────────────────────────────────────────────

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

// ── File processing ────────────────────────────────────────────────────────────

function processFile(filePath, write, verbose) {
  const content = fs.readFileSync(filePath, "utf8");

  // Must have frontmatter
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return "no-frontmatter";

  let frontmatter = match[1];
  const body      = match[2];

  // Extract title
  const titleMatch = frontmatter.match(/^title:\s*"([^"]+)"/m);
  if (!titleMatch) return "no-title";
  const title = titleMatch[1];

  let changed = false;

  // Add meeting-type if missing
  if (!/^meeting-type:/m.test(frontmatter)) {
    const mt = inferMeetingType(title);
    // Insert after "source:" line
    if (/^source:/m.test(frontmatter)) {
      frontmatter = frontmatter.replace(/(^source:.*$)/m, `$1\nmeeting-type: ${mt}`);
    } else {
      // Fallback: insert after "type:" line
      frontmatter = frontmatter.replace(/(^type:.*$)/m, `$1\nmeeting-type: ${mt}`);
    }
    changed = true;
  }

  // Add processed: false if missing
  if (!/^processed:/m.test(frontmatter)) {
    // Insert before dropbox_source, or at end of frontmatter
    if (/^dropbox_source:/m.test(frontmatter)) {
      frontmatter = frontmatter.replace(/(^dropbox_source:)/m, `processed: false\n$1`);
    } else {
      frontmatter = frontmatter + "\nprocessed: false";
    }
    changed = true;
  }

  if (changed) {
    if (write) {
      fs.writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}`, "utf8");
    }
    if (verbose) {
      const rel = path.relative(VAULT_ROOT, filePath);
      console.log(`  ${write ? "Updated" : "Would update"}: ${rel}`);
    }
    return "changed";
  }

  return "already-up-to-date";
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const write   = process.argv.includes("--write");
  const verbose = process.argv.includes("--verbose");

  if (!write) {
    console.log("DRY RUN — pass --write to apply changes\n");
  }

  let total = 0, changed = 0, upToDate = 0, skipped = 0;

  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    console.error(`Transcripts dir not found: ${TRANSCRIPTS_DIR}`);
    process.exit(1);
  }

  const months = fs.readdirSync(TRANSCRIPTS_DIR).sort();
  for (const month of months) {
    const monthDir = path.join(TRANSCRIPTS_DIR, month);
    if (!fs.statSync(monthDir).isDirectory()) continue;

    const files = fs.readdirSync(monthDir)
      .filter(f => f.endsWith(".md"))
      .sort();

    for (const file of files) {
      const result = processFile(path.join(monthDir, file), write, verbose);
      total++;
      if (result === "changed")            changed++;
      else if (result === "already-up-to-date") upToDate++;
      else                                  skipped++;
    }
  }

  console.log(`\nTotal: ${total} files`);
  console.log(`  ${write ? "Updated" : "Would update"}: ${changed}`);
  console.log(`  Already up to date: ${upToDate}`);
  console.log(`  Skipped (no frontmatter/title): ${skipped}`);

  if (!write && changed > 0) {
    console.log(`\nRun with --write to apply changes.`);
  }
}

main();
