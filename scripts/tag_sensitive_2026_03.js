#!/usr/bin/env node
/**
 * tag_sensitive_2026_03.js — One-time script to tag personal/sensitive files in 2026-03
 *
 * Adds topic/personal + sensitive, or topic/job-search + sensitive, to files
 * that were missed by the bulk tag scripts (title-based inference didn't catch them).
 *
 * Usage:
 *   node tag_sensitive_2026_03.js            # Dry run
 *   node tag_sensitive_2026_03.js --write    # Apply changes
 */

const fs   = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;
const VAULT_ROOT = path.join(SCRIPT_DIR, "..", "..");
const TRANS_DIR  = path.join(VAULT_ROOT, "Transcripts", "2026-03");

const WRITE = process.argv.includes("--write");

// Files that need topic/personal + sensitive + domain:personal
const PERSONAL_FILES = [
  "2026-03-31_Marriage and Engagement Concerns.md",
  "2026-03-31_Caregiving and Work Balance Meeting.md",
  "2026-03-31_Family Support Coordination Meeting.md",
  "2026-03-31_Estate Planning Consultation.md",
  "2026-03-31_ALS Care Coordination Meeting.md",
  "2026-03-31_ALS Association _ Initial In Person Meeting.md",
  "2026-03-31_Patient Care Coordination Meeting.md",
  "2026-03-31_Life Insurance _ AIG _ David A Van Es.md",
  "2026-03-31_Tax Preparation Consultation.md",
  "2026-03-31_Relationship Dynamics Exploration.md", // already has sensitive, needs topic/personal + domain
];

// Files that need topic/job-search + sensitive + domain:personal
const JOB_SEARCH_FILES = [
  "2026-03-31_Resume Optimization Session.md",
];

// Files that need only sensitive tag (work content, HR/medical sensitive)
const WORK_SENSITIVE_FILES = [
  "2026-03-31_GSI _ People & Talent _ Medical & Missed Days.md",
  "2026-03-31_GSI _ Reviewing Leave.md",
];

function addTagsToFile(filePath, tagsToAdd, domainOverride) {
  const content = fs.readFileSync(filePath, "utf8");

  // Find the frontmatter block
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    console.log(`  SKIP (no frontmatter): ${path.basename(filePath)}`);
    return;
  }

  let fm = fmMatch[1];
  const rest = content.slice(fmMatch[0].length);

  // Check what tags already exist
  const tagsMatch = fm.match(/^tags:\n((?:  - .*\n)*)/m);
  let existingTags = [];
  if (tagsMatch) {
    existingTags = tagsMatch[1].match(/  - (.+)/g)?.map(t => t.replace("  - ", "").trim()) || [];
  }

  const newTags = tagsToAdd.filter(t => !existingTags.includes(t));
  if (newTags.length === 0 && !domainOverride) {
    console.log(`  SKIP (already tagged): ${path.basename(filePath)}`);
    return;
  }

  console.log(`  ADD to ${path.basename(filePath)}: ${newTags.join(", ")}${domainOverride ? ` + domain:${domainOverride}` : ""}`);

  if (!WRITE) return;

  // Add new tags to the tags block
  if (tagsMatch && newTags.length > 0) {
    const newTagLines = newTags.map(t => `  - ${t}`).join("\n");
    fm = fm.replace(tagsMatch[0], tagsMatch[0].trimEnd() + "\n" + newTagLines + "\n");
  } else if (!tagsMatch && newTags.length > 0) {
    fm += `\ntags:\n${newTags.map(t => `  - ${t}`).join("\n")}`;
  }

  // Add domain if missing and override is specified
  if (domainOverride && !fm.includes("domain:")) {
    fm += `\ndomain: ${domainOverride}`;
  }

  // Add org if missing and domain is personal
  if (domainOverride === "personal" && !fm.includes("org:")) {
    fm += `\norg: personal`;
  }

  const updated = `---\n${fm}\n---${rest}`;
  fs.writeFileSync(filePath, updated, "utf8");
}

console.log(`\n=== tag_sensitive_2026_03.js (${WRITE ? "WRITE" : "DRY RUN"}) ===\n`);

console.log("Personal + sensitive files:");
for (const f of PERSONAL_FILES) {
  addTagsToFile(path.join(TRANS_DIR, f), ["topic/personal", "sensitive"], "personal");
}

console.log("\nJob-search + sensitive files:");
for (const f of JOB_SEARCH_FILES) {
  addTagsToFile(path.join(TRANS_DIR, f), ["topic/job-search", "sensitive"], "personal");
}

console.log("\nWork-sensitive files (sensitive tag only):");
for (const f of WORK_SENSITIVE_FILES) {
  addTagsToFile(path.join(TRANS_DIR, f), ["sensitive"], null);
}

console.log(`\nDone.${WRITE ? "" : " Run with --write to apply."}\n`);
