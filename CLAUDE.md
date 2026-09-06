# Amanah Care — coding rules for AI agents (anti-slop)

This file loads automatically when you work in this repo. Follow it exactly. Read `agents/HANDOFF.md` before touching code.

## Scope (the #1 cause of slop)
- Do ONLY what was asked. Nothing extra.
- No new files, features, dependencies, or refactors unless the task names them.
- Do not widen, narrow, or "improve" the task on your own.
- If two readings are possible, ask ONE question, then proceed. Do not guess and build.
- Smallest diff that solves it. Change the fewest lines.

## No slop
- No placeholder, fake, or mocked code passed off as working. If it is a stub, say "stub".
- No dead code, no commented-out blocks, no leftover TODOs, no console.log spam.
- Do not reinvent what exists. Search first: `esc()`, `api()`, `postEvent()`, `encryptJSON()`, `decryptJSON()`, `nameOf()`, `renderSent()` already exist in `app/web/app.js` and `crypto.js`.
- No new abstraction for a single use. No new library or framework unless asked.
- No emoji in code. No decorative comments. Comment only the non-obvious "why", not the "what".
- Do not write long READMEs or docs unless asked. Match the length of the task.

## Match this codebase (do not change its shape)
- Web is vanilla ES modules, no build step, served by nginx. Keep it that way.
- Crypto only through `crypto.js`. Never roll your own. Never send H or plaintext to the server. Never log secrets.
- Server stores ciphertext only. Clear fields are routing metadata only (type, actor_id, category, ids, timestamps).
- One global Redis stream `events`, one consumer group. Do not change the architecture without being asked.
- One column, phone-first UI, 44px touch targets, no hover-only controls.

## Verify before you say "done" (the other #1 cause of slop)
- Rebuild and load the page. Check the browser console for errors first: one top-level syntax error blanks the entire app (a duplicate `esc` did exactly this once).
- Rebuild the web container after web edits: `docker compose up -d --build web`. nginx has no-store headers, but hard-reload with `?v=<timestamp>` when testing.
- Exercise the real flow, not just "it compiles". Say exactly what you ran and what you saw.
- Do not claim a test passed or a coverage number you did not actually produce.

## Honesty
- Report failures with the real error text. Never say "done" if it is not.
- Do not invent APIs, fields, or file paths. Confirm they exist before using them.
- State your assumptions in one line.

## Before you finish
- Re-read your own diff. Delete anything not required by the task.
- Run `/code-review` (or the `simplify` skill) on your change and fix what it flags.
- Do not push to GitHub unless the owner explicitly says so.

## If you catch yourself doing any of these, stop
- Adding "while I'm here" changes.
- Creating a file nobody asked for.
- Writing a paragraph where one line works.
- Building the deferred/roadmap items (see `agents/HANDOFF.md` §5) without being asked.
- Explaining instead of doing, or doing instead of asking when it is genuinely ambiguous.
