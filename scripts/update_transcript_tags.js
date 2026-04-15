#!/usr/bin/env node
/**
 * update_transcript_tags.js — Standardize tags on all processed transcripts
 *
 * Strategy (conservative):
 *   1. Keep type tags: transcript, otter
 *   2. Rename old ad-hoc topic tags to topic/* equivalents
 *   3. Infer and ADD new topic/sensitive tags from title keywords
 *   4. Remove noise tags (person names, org names, geography) that belong elsewhere
 *   5. Never silently remove tags without a replacement logged
 *
 * Usage:
 *   node update_transcript_tags.js            # Dry run
 *   node update_transcript_tags.js --write    # Apply all changes
 *   node update_transcript_tags.js --write --verbose
 */

const fs   = require("fs");
const path = require("path");

const SCRIPT_DIR      = __dirname;
const VAULT_ROOT      = path.join(SCRIPT_DIR, "..", "..");
const TRANSCRIPTS_DIR = path.join(VAULT_ROOT, "Transcripts");

const WRITE   = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");

// ── Tag Transformation Rules ──────────────────────────────────────────────────

// Old tag → new tag (null = remove without replacement; these are noise tags)
const TAG_RENAME = {
  "msa":              "topic/msa",
  "legal":            "topic/compliance",    // legal review, contracts → compliance
  "traffic-control":  "topic/traffic-control",
  "vendor-setup":     "topic/vendor-setup",
  "vendor-payments":  "topic/ap-invoicing",
  "vista":            "topic/budget",
  "three-bids":       "topic/ppv",
  "therapy":          "topic/personal",
  "personal":         "topic/personal",      // standalone → namespaced
  "job-search":       "topic/job-search",
  "logistics":        "topic/logistics",     // old flat → namespaced
  "shipping":         "topic/logistics",     // shipping is logistics
  "procurement":      null,   // too broad — meeting-type field handles this
  "meeting":          null,   // too broad — meeting-type field handles this
  "vendor":           null,   // too broad — contact/* tags on People profiles handle this
  "vicki":            null,   // person name in tags is bad practice
  "wwex":             null,   // org info belongs in People profile tags, not here
  "west-virginia":    null,   // geographic — low search value
  "ap":               null,   // replaced by topic/ap-invoicing
};

// Tags to always keep as-is (type tags, pipeline tags)
const KEEP_ALWAYS = new Set([
  "transcript", "otter", "claude-code-session",
]);

// Tags that are already in new format (topic/*, sensitive, etc.) — keep as-is
function isNewFormatTag(tag) {
  return tag.startsWith("topic/") ||
         tag.startsWith("disc/") ||
         tag.startsWith("org/") ||
         tag.startsWith("contact/") ||
         tag.startsWith("relationship/") ||
         tag === "sensitive" ||
         tag === "person" ||
         tag === "self" ||
         tag === "departed";
}

// ── Topic Inference from Title + Meeting Type ─────────────────────────────────

function inferTopics(title, meetingType) {
  const t = (title || "").toLowerCase();
  const m = (meetingType || "").toLowerCase();
  const inferred = new Set();

  // MSA negotiations
  if (/\bmsa\b|master service agreement/.test(t)) inferred.add("topic/msa");

  // PPV / cost savings
  if (/\bppv\b|barriers to ppv|three bids|3 bids|bids and a buy/.test(t)) inferred.add("topic/ppv");

  // AP / invoicing
  if (/\bap sourcing\b|invoice|billing|aged invoice|vendor payment|problem solving/i.test(t) &&
      /dumpsters|ldr|ecm|heidelberg|caterpillar|sunbelt|wwex|ap /i.test(t)) {
    inferred.add("topic/ap-invoicing");
  }
  if (/\bap sourcing weekly\b/.test(t)) inferred.add("topic/ap-invoicing");

  // Traffic control
  if (/traffic|roadsafe|road safe|h&m traffic|roadguard|saf-ti-co|road safety systems/i.test(t)) {
    inferred.add("topic/traffic-control");
  }

  // Logistics
  if (/wwex|worldwide express|\blogistics\b|\bfreight\b/i.test(t)) inferred.add("topic/logistics");

  // Vendor setup / onboarding
  if (/vendor setup|new vendor|vendor onboard/i.test(t)) inferred.add("topic/vendor-setup");

  // Budget / dashboard / data tools
  if (/\bb2w\b|\bbids.*buy dashboard\b|\bvista dashboard\b|\bbudget/i.test(t)) inferred.add("topic/budget");
  if (/ud fields|scope.*rollout|credit application/i.test(t)) inferred.add("topic/vendor-setup");

  // Compliance / safety
  if (/\bcompliance\b|\bsafety\b|\bincident\b/i.test(t)) inferred.add("topic/compliance");

  // Personal / therapy
  if (/\btherapy\b|elizabeth weir|lcsw|counseling/i.test(t)) {
    inferred.add("topic/personal");
    inferred.add("sensitive");
  }
  if (m === "therapy" || m === "counseling") {
    inferred.add("topic/personal");
    inferred.add("sensitive");
  }

  // Job search (sensitive) — BEUMER interview transcripts only
  if (/beumer/i.test(t) || /procurement manager interview/i.test(t)) {
    inferred.add("topic/job-search");
    inferred.add("sensitive");
  }

  // PPV workshop / strategy
  if (/barriers to ppv|ppv.*workshop|ppv.*project/i.test(t)) inferred.add("topic/ppv");

  // Shotcrete / cement
  if (/shotcrete|cement|3 bids.*handoff/i.test(t)) inferred.add("topic/shotcrete");

  // LDR / portable sanitation
  if (/\bldr\b/i.test(t)) inferred.add("topic/vendor-setup");

  return inferred;
}

// ── Frontmatter helpers ───────────────────────────────────────────────────────

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

function getFrontmatterField(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, "m"));
  return match ? match[1].trim() : "";
}

function getExistingTags(frontmatter) {
  const tags = [];
  const lines = frontmatter.split("\n");
  let inTags = false;
  for (const line of lines) {
    if (/^tags:/.test(line)) { inTags = true; continue; }
    if (inTags && /^  - (.+)/.test(line)) {
      tags.push(line.replace(/^  - /, "").trim().replace(/^["']|["']$/g, ""));
    } else if (inTags) { inTags = false; }
  }
  return tags;
}

function buildNewTags(existingTags, inferredTopics) {
  const result = new Set();
  const removed = [];

  for (const tag of existingTags) {
    if (KEEP_ALWAYS.has(tag)) {
      result.add(tag);
      continue;
    }
    if (isNewFormatTag(tag)) {
      result.add(tag);
      continue;
    }
    if (TAG_RENAME.hasOwnProperty(tag)) {
      const newTag = TAG_RENAME[tag];
      if (newTag) {
        result.add(newTag);
      } else {
        removed.push(tag); // noise tag, dropped
      }
      continue;
    }
    // Unknown tag — keep it, log for review
    result.add(tag);
  }

  // Merge inferred topics
  for (const t of inferredTopics) {
    result.add(t);
  }

  // Consistent ordering: type tags first, then topic, then org, then rest
  const ordered = [
    ...["transcript", "otter"].filter(t => result.has(t)),
    ...[...result].filter(t => t.startsWith("topic/")).sort(),
    ...[...result].filter(t => t === "sensitive"),
    ...[...result].filter(t =>
      !t.startsWith("topic/") && t !== "transcript" && t !== "otter" && t !== "sensitive"
    ).sort(),
  ];

  return { tags: ordered, removed };
}

function updateTagsInFrontmatter(frontmatter, newTags) {
  const lines = frontmatter.split("\n");
  const result = [];
  let inTagsBlock = false;
  let tagsWritten = false;

  for (const line of lines) {
    if (/^tags:/.test(line)) {
      inTagsBlock = true;
      result.push("tags:");
      for (const tag of newTags) result.push(`  - ${tag}`);
      tagsWritten = true;
      continue;
    }
    if (inTagsBlock) {
      if (/^  - /.test(line)) continue;
      else { inTagsBlock = false; result.push(line); }
    } else {
      result.push(line);
    }
  }

  if (!tagsWritten) {
    result.push("tags:");
    for (const tag of newTags) result.push(`  - ${tag}`);
  }

  return result.join("\n");
}

// ── Walk transcript directory recursively ─────────────────────────────────────

function walkDir(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, callback);
    else if (entry.isFile() && entry.name.endsWith(".md")) callback(full, entry.name);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (!WRITE) console.log("DRY RUN — pass --write to apply changes\n");

  let updated = 0, unchanged = 0, skipped = 0, total = 0;

  walkDir(TRANSCRIPTS_DIR, (filePath, filename) => {
    total++;
    const parsed = parseFile(filePath);
    if (!parsed) { skipped++; return; }

    const { frontmatter, body } = parsed;
    const title       = getFrontmatterField(frontmatter, "title");
    const meetingType = getFrontmatterField(frontmatter, "meeting-type");
    const existing    = getExistingTags(frontmatter);
    const inferred    = inferTopics(title, meetingType);
    const { tags: newTags, removed } = buildNewTags(existing, inferred);

    const existingStr = existing.join(", ");
    const newStr      = newTags.join(", ");

    if (existingStr === newStr) { unchanged++; return; }

    if (VERBOSE || !WRITE) {
      console.log(`\n  ${filename}`);
      if (title) console.log(`    Title: "${title}"`);
      console.log(`    BEFORE: ${existingStr || "(none)"}`);
      console.log(`    AFTER:  ${newStr}`);
      if (removed.length) console.log(`    REMOVED (noise): ${removed.join(", ")}`);
    } else if (WRITE) {
      console.log(`  [UPDATED] ${filename}`);
    }

    if (WRITE) {
      const newFm      = updateTagsInFrontmatter(frontmatter, newTags);
      const newContent = `---\n${newFm}\n---\n${body}`;
      fs.writeFileSync(filePath, newContent, "utf8");
    }
    updated++;
  });

  console.log(`\n─────────────────────────────────`);
  console.log(`Total transcripts: ${total}`);
  console.log(`Would update:      ${updated}` + (WRITE ? " (written)" : " (dry run)"));
  console.log(`Already correct:   ${unchanged}`);
  console.log(`No frontmatter:    ${skipped}`);
  if (!WRITE && updated > 0) console.log(`\nRun with --write to apply changes.`);
}

main();
