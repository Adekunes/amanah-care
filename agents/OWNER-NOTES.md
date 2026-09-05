# Owner notes and directives (raw)

Every instruction the owner gave this session, close to his words, so the next agent has the source, not just my summary. Read alongside `agents/README.md`.

## Original brief

- "The objective is to set up a plan, a spec, without giving us the code." He wanted spec first, no code, until he said build.
- "I work as a solutions architect. I work with event-driven systems. I want everything with events."
- "Client data must not be shared when clients come in. I don't want other clients to know what they have inside. I want the data masked for everyone, even for me. Only family members can see their data." The key is "H": only the family has that H. "If they lose the H, we give them the choice to make a second H."
- "I want a very, very simple database with a few tables for a product, really at the minimum. I'm at a hackathon and I don't want to develop the whole base. Keep it to a minimum we can demo tomorrow."
- "Make the plan in simple English, visually explaining everything, use /excalidraw flowchart."
- "Use Redis as event sourcing, Docker as container, PostgreSQL as database."

## Track context (from the PDF he pasted)

MuslimHacks 2026, Elderly Care track. His team was on Elderly Care. Full name for Discord: Abdul Quayum Adekunle. The challenge asks: caregiver handoffs, workload visibility, personal preferences, elder participation. Constraints: health info needs consent and privacy; no diagnosis/dosage/triage; "Muslim-friendly" is not one setting. Before-you-build questions: who is the primary user, why better than the family WhatsApp group, who can access the data and who controls that access.

## Directives given during the work

- "Fix the five fixes." (Apply the five audit fixes to the spec.)
- "For MVP reason webpage first and mobile after."
- "Extract all the requirements from the spec, make tasks. Do not deploy, do not produce, do not code. Use two agents, only two, to audit the requirements. You do the extraction, the other agents audit."
- "Start an audit. Two agents. No building yet. Check feasibility of developing in 24 hours. Keep it simple to demo, simple to use, but do not compromise quality. If it has to be developed properly and it takes more time, then fine, say so."
- Scope decision: **cut core**. He asked "why not?" to the full scope and wanted it in simple English before deciding; after the explanation he chose cut core.
- Key sharing decision: **QR in person**.
- Apply mode: **propose fixes, wait for yes**, then he said "yes apply the fixes".
- "Go ahead and build out. Let's continue." (Green light to build the cut core.)
- "Make a GitHub repo and invite my partner safio (github.com/safio)."
- "Make a README for agents, make a folder for the agents, in case my account runs out of usage so I can continue with another account on the same repo. Put observation notes, notes, every single thing we went through, all the notes we told me, all the things we changed to the plan. A handoff to another session."

## Standing preferences that apply to him (from his global config)

- Caveman mode active: terse replies, drop articles/filler. Code and commits stay normal.
- Writing rules: no em-dashes, no "shift", no "here's the thing", no anaphora/staccato/reversal/rhetorical-question patterns. A `writing-lint` harness enforces this on prose deliverables.
- Ask clarifying questions before big work, via the question tool, batched.
- Comparisons as markdown tables, short cells.
- He rejects the safe/minimal option by default and likes ambitious full-scope builds, but for THIS hackathon he explicitly chose the disciplined cut-core scope. Honor the explicit choice.
- Never create a git repo in the home directory. Repos go in `~/Developer/<project>/`.
