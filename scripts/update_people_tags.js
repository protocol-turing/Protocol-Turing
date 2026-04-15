#!/usr/bin/env node
/**
 * update_people_tags.js — Standardize tags on all People profiles
 *
 * Replaces ad-hoc and inconsistent tags with a structured taxonomy:
 *
 *   CONTACT TYPE  contact/internal/manager|peer|buyer|leadership
 *                 contact/vendor/traffic-control|waste|logistics|shotcrete|legal
 *                 contact/personal/therapist|partner|family|friend
 *                 contact/external/recruiter
 *                 contact/vendor           (uncategorized vendor)
 *                 contact/personal         (uncategorized personal)
 *
 *   ORG           org/gsi | org/snh | org/alc | org/rsts | org/wwex
 *                 org/ecm | org/beumer | org/ifc | org/rss | org/dumpsters
 *
 *   TOPIC         topic/ppv | topic/msa | topic/ap-invoicing
 *                 topic/traffic-control | topic/logistics | topic/shotcrete
 *                 topic/vendor-setup | topic/budget | topic/compliance
 *                 topic/job-search | topic/personal
 *
 *   DISC          disc/d | disc/i | disc/s | disc/c   (combine for mixed types)
 *
 *   RELATIONSHIP  relationship/strong | relationship/strained | relationship/monitoring
 *
 *   SPECIAL       departed | self | sensitive
 *
 * Usage:
 *   node update_people_tags.js            # Dry run — show what would change
 *   node update_people_tags.js --write    # Apply all changes
 *   node update_people_tags.js --write --verbose  # Apply + show each diff
 */

const fs   = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;
const VAULT_ROOT = path.join(SCRIPT_DIR, "..", "..");
const PEOPLE_DIR = path.join(VAULT_ROOT, "People");

const WRITE   = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");

// ── Tag Mapping ───────────────────────────────────────────────────────────────
// Source of truth for every People profile. Each array is the complete tags list
// (replaces whatever was there before). "person" is always first.
//
// Taxonomy rationale for key decisions:
//   contact/internal/peer    = sourcing peers, operations, buyers at GSI/SNH
//   contact/internal/buyer   = dedicated buyer role (ops support, not strategic)
//   contact/internal/leadership = VP / Director / Head level
//   relationship/monitoring  = worth watching; not strained but not settled either
//   sensitive                = private content — job search, therapy, legal/HR risk

const PEOPLE_TAGS = {
  "Adam Hosterman.md":           ["person", "org/gsi", "contact/internal/peer"],
  "Adam Palmer.md":              ["person", "org/gsi", "contact/internal/peer"],
  "Adrian Miller.md":            ["person", "org/wwex", "contact/vendor/logistics", "topic/logistics"],
  "Allison Lunsford.md":         ["person", "org/gsi", "contact/internal/leadership", "topic/logistics"],
  "Alondra Ceniceros.md":        ["person", "org/gsi", "contact/internal/peer"],
  "Amanda Blade.md":             ["person", "org/gsi", "contact/internal/peer"],
  "Amanda Reyes.md":             ["person", "org/gsi", "contact/internal/peer", "topic/vendor-setup", "topic/compliance"],
  "Anders McCarthy.md":          ["person", "org/gsi", "contact/internal/buyer", "relationship/strong"],
  "Andreas Kavallar.md":         ["person", "org/gsi", "contact/internal/peer", "topic/ppv", "disc/c"],
  "Andrew Freibert.md":          ["person", "contact/vendor/traffic-control", "topic/msa", "topic/traffic-control"],
  "Andrew Hayden.md":            ["person", "contact/vendor"],
  "Angie Sheff.md":              ["person", "org/gsi", "contact/internal/buyer", "topic/ap-invoicing"],
  "Ann Rhoads.md":               ["person", "contact/personal/family", "topic/personal", "sensitive"],
  "Anthony Belletini.md":        ["person", "org/gsi", "contact/internal/peer"],
  "Austin Conner.md":            ["person", "org/gsi", "contact/internal/buyer"],
  "Beatris Sandoval.md":         ["person", "org/snh", "contact/internal/peer"],
  "Bill Yost.md":                ["person", "org/gsi", "contact/internal/leadership"],
  "Brad Engelbrecht.md":         ["person", "org/rsts", "contact/vendor/traffic-control", "disc/i", "disc/d", "relationship/strong", "topic/msa", "topic/traffic-control"],
  "Brandon Galarza.md":          ["person", "org/gsi", "contact/internal/peer"],
  "Cesar Corralejo.md":          ["person", "org/gsi", "contact/internal/peer", "disc/s", "disc/c", "topic/ap-invoicing"],
  "Chip Pappas.md":              ["person", "org/rsts", "contact/vendor/traffic-control", "departed"],
  "Chris Haught.md":             ["person", "org/ecm", "contact/vendor"],
  "Chris Monahan.md":            ["person", "org/gsi", "contact/internal/peer", "departed"],
  "Christian Stoglin.md":        ["person", "org/gsi", "contact/internal/peer"],
  "Christina G..md":             ["person", "org/gsi", "contact/internal/peer"],
  "Claire Cannetti.md":          ["person", "org/gsi", "contact/internal/peer"],
  "David A Van Es.md":           ["person", "contact/personal"],
  "Elizabeth Weir.md":           ["person", "contact/personal/therapist", "topic/personal", "sensitive"],
  "Emilio Buxton.md":            ["person", "org/gsi", "contact/internal/peer"],
  "Emmet Getz.md":               ["person", "org/snh", "contact/internal/buyer", "disc/s", "disc/c", "topic/vendor-setup", "topic/budget"],
  "Erick Saldana.md":            ["person", "org/gsi", "contact/internal/peer"],
  "Garrett Strawn.md":           ["person", "org/gsi", "contact/internal/peer", "topic/compliance"],
  "Glenn Meeter.md":             ["person", "org/gsi", "contact/internal/buyer"],
  "Graham Bianchi.md":           ["person", "org/snh", "contact/internal/leadership", "disc/d", "disc/c", "relationship/monitoring", "topic/ap-invoicing", "topic/ppv", "topic/compliance"],
  "Harmony Ward.md":             ["person", "org/gsi", "contact/internal/peer"],
  "IFC — Ideal Fencing Corp.md": ["person", "org/ifc", "org/snh"],
  "Jake Chavez.md":              ["person", "org/dumpsters", "contact/vendor/waste", "topic/ap-invoicing"],
  "Jason Heatherly.md":          ["person", "org/gsi", "contact/internal/peer"],
  "Jeff Wood.md":                ["person", "org/gsi", "contact/internal/buyer", "topic/budget"],
  "Jennifer Medrano.md":         ["person", "org/gsi", "contact/internal/peer"],
  "Jesse Friel.md":              ["person", "contact/vendor/shotcrete"],
  "John Hohman.md":              ["person", "org/ecm", "contact/vendor"],
  "Kaitlin Lane.md":             ["person", "org/gsi", "contact/internal/peer"],
  "Kevin Hadley.md":             ["person", "org/snh", "contact/internal/peer", "disc/s", "disc/c", "topic/ppv", "topic/vendor-setup", "topic/budget"],
  "Kristen MacDonald.md":        ["person", "org/gsi", "contact/internal/peer", "disc/i", "disc/s", "relationship/strong", "topic/ppv", "topic/msa", "topic/shotcrete"],
  "Levi Kallio.md":              ["person", "org/gsi", "contact/internal/peer", "disc/i", "relationship/strong", "topic/compliance", "topic/logistics"],
  "Luke Downey.md":              ["person", "org/gsi", "contact/internal/peer"],
  "McKayla Leitch.md":           ["person", "org/gsi", "contact/internal/peer", "topic/compliance"],
  "Melissa Dineen.md":           ["person", "org/alc", "contact/internal/peer"],
  "Michael Wolff.md":            ["person", "org/gsi", "contact/internal/buyer", "departed"],
  "Mike W..md":                  ["person", "org/gsi", "contact/internal/peer"],
  "Nico Ceaser.md":              ["person", "contact/personal/friend", "topic/personal"],
  "Rachel Gruebbel.md":          ["person", "org/snh", "contact/internal/leadership", "topic/msa", "topic/compliance"],
  "Randy Baugher.md":            ["person", "org/ecm", "contact/vendor"],
  "Robert Stahl.md":             ["person", "org/ecm", "contact/vendor"],
  "Romny Ames.md":               ["person", "contact/personal"],
  "RSS — Road Safety Systems.md":["person", "org/rss", "org/snh"],
  "Ryan Miller.md":              ["person", "contact/vendor/waste", "topic/vendor-setup"],
  "Sady Rivera.md":              ["person", "org/beumer", "contact/external/recruiter", "topic/job-search", "sensitive"],
  "Scott Olson.md":              ["person", "contact/personal"],
  "Sean Flanagan.md":            ["person", "org/dumpsters", "contact/vendor/waste", "topic/ap-invoicing", "topic/msa"],
  "Shawn Patilla.md":            ["person", "org/gsi", "contact/internal/peer"],
  "Stefan Brown.md":             ["person", "org/gsi", "contact/internal/peer"],
  "Tanner Dodd.md":              ["person", "org/alc", "contact/internal/peer"],
  "Travis Cawthorn.md":          ["person", "org/gsi", "contact/internal/peer", "topic/compliance", "topic/traffic-control"],
  "Tristan Fuller.md":           ["person", "org/wwex", "contact/vendor/logistics", "topic/logistics"],
  "Turner Sanders.md":           ["person", "org/gsi", "contact/internal/peer"],
  "Vicki Krallis.md":            ["person", "org/snh", "contact/internal/manager", "disc/d", "disc/i", "relationship/strained", "topic/ppv", "topic/msa", "sensitive"],
  "William Walker.md":           ["person", "org/gsi", "self"],
  "Zonash Yaseen.md":            ["person", "org/gsi", "contact/internal/peer"],
};

// ── Frontmatter manipulation ───────────────────────────────────────────────────

function updateTagsInFrontmatter(frontmatter, newTags) {
  const lines = frontmatter.split("\n");
  const result = [];
  let inTagsBlock = false;
  let tagsWritten = false;

  for (const line of lines) {
    if (/^tags:/.test(line)) {
      // Start of tags block — write our new tags instead
      inTagsBlock = true;
      result.push("tags:");
      for (const tag of newTags) {
        result.push(`  - ${tag}`);
      }
      tagsWritten = true;
      continue;
    }

    if (inTagsBlock) {
      if (/^  - /.test(line)) {
        continue; // Skip old tag lines
      } else {
        inTagsBlock = false;
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  // If file had no tags block at all, append one
  if (!tagsWritten) {
    result.push("tags:");
    for (const tag of newTags) {
      result.push(`  - ${tag}`);
    }
  }

  return result.join("\n");
}

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2], raw };
}

function getExistingTags(frontmatter) {
  const tags = [];
  const lines = frontmatter.split("\n");
  let inTags = false;
  for (const line of lines) {
    if (/^tags:/.test(line)) { inTags = true; continue; }
    if (inTags && /^  - (.+)/.test(line)) { tags.push(line.replace(/^  - /, "").trim()); }
    else if (inTags) { inTags = false; }
  }
  return tags;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (!WRITE) {
    console.log("DRY RUN — pass --write to apply changes\n");
  }

  const files = fs.readdirSync(PEOPLE_DIR).filter(f => f.endsWith(".md")).sort();

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  let notMapped = 0;

  for (const filename of files) {
    const filePath = path.join(PEOPLE_DIR, filename);
    const newTags  = PEOPLE_TAGS[filename];

    if (!newTags) {
      console.log(`  [NOT MAPPED] ${filename} — add to PEOPLE_TAGS manually`);
      notMapped++;
      continue;
    }

    const parsed = parseFile(filePath);
    if (!parsed) {
      console.log(`  [SKIP] ${filename} — no frontmatter found`);
      skipped++;
      continue;
    }

    const existingTags = getExistingTags(parsed.frontmatter);
    const existingStr  = existingTags.join(", ");
    const newStr       = newTags.join(", ");

    if (existingStr === newStr) {
      if (VERBOSE) console.log(`  [SAME] ${filename}`);
      unchanged++;
      continue;
    }

    if (VERBOSE || !WRITE) {
      console.log(`\n  ${filename}`);
      console.log(`    BEFORE: ${existingStr || "(none)"}`);
      console.log(`    AFTER:  ${newStr}`);
    }

    if (WRITE) {
      const newFrontmatter = updateTagsInFrontmatter(parsed.frontmatter, newTags);
      const newContent     = `---\n${newFrontmatter}\n---\n${parsed.body}`;
      fs.writeFileSync(filePath, newContent, "utf8");
      if (!VERBOSE) console.log(`  [UPDATED] ${filename}`);
      updated++;
    } else {
      updated++; // Count as "would update" in dry run
    }
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Total files:    ${files.length}`);
  console.log(`Would update:   ${updated}` + (WRITE ? " (written)" : " (dry run)"));
  console.log(`Already correct:${unchanged}`);
  console.log(`No frontmatter: ${skipped}`);
  console.log(`Not in mapping: ${notMapped}`);
  if (!WRITE && updated > 0) {
    console.log(`\nRun with --write to apply changes.`);
  }
}

main();
