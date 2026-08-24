# Aperta

**Your code works. Could you explain why?**

[![npm beta](https://img.shields.io/npm/v/aperta-cli/beta?label=npm%20beta)](https://www.npmjs.com/package/aperta-cli)
[![CI](https://github.com/Vequan23/aperta/actions/workflows/ci.yml/badge.svg)](https://github.com/Vequan23/aperta/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Public beta:** Aperta is ready for evaluation and real local projects, but
> its interfaces and evidence schema may change before the first stable release.

AI coding agents make it easy to ship code you cannot explain. Aperta measures
that comprehension gap before it becomes a debugging, maintenance, or ownership
problem. It records what changed, asks for a quick self-rating, and shows where
the codebase has outrun your understanding. It records explanations but does not
grade them.

The current 1.0 beta combines a provider-neutral coding-agent harness with a
local comprehension system. It observes changes from any editor or agent,
executes bounded work in disposable Git worktrees, verifies outcomes, and turns
the resulting evidence into review sessions, a learning journal, and a durable
Proof Graph.

The local Vue dashboard includes:

- Agent Workbench with persistent multi-turn conversations
- Aperta Native, Cursor Agent, Claude Code, and OpenCode execution runtimes
- OpenAI, Anthropic, Google Gemini, DeepSeek, Ollama, OpenRouter, Groq, and
  OpenAI-compatible model profiles
- staged, unstaged, and untracked Git views
- syntax-highlighted source, diffs, agent responses, and execution output
- repository, impact, and behavioral Proof Graphs
- guided ownership sessions, Review Queue, Learn Next, and Learning Journal
- local harness reliability, verification, repair, and trusted-keep metrics

Repository evidence stays in private per-user storage unless the user explicitly
invokes a configured model. Credentials never enter project memory.

## How the harness is divided

Aperta deliberately separates three responsibilities:

- **Model APIs reason.** A configured model can plan, explain, and choose from
  Aperta's bounded tools.
- **Agent runtimes execute.** Aperta Native, Cursor Agent, Claude Code, or
  OpenCode can inspect and edit an isolated workspace. External runtimes keep
  their own authentication and model configuration.
- **Aperta owns trust.** Aperta selects the skill contract, constrains
  capabilities, captures actions, runs deterministic checks and localhost
  probes, controls promotion, and records proof and learning evidence.

Changing the runtime or model never gives it authority to declare its own work
correct or understood.

## Aperta Coach (optional AI)

Aperta Coach turns the deterministic ownership brief into an adaptive change
debrief. It can orient the maintainer and personalize trace, failure-mode,
evidence, and debugging questions. Model output remains visibly AI-generated:
it cannot change Trust Kernel relationships, mark runtime evidence as proven,
grade prose, or award ownership. Returned file citations are accepted only when
they match files in the captured change.

Coach is provider-neutral and configured through environment variables so API
keys never enter the project config or ledger. It supports native OpenAI,
Anthropic, Google Gemini, DeepSeek, and Ollama APIs; OpenRouter and Groq
gateways; and any OpenAI-compatible HTTPS or local endpoint, including LM
Studio.

```sh
# OpenAI (OPENAI_API_KEY is read automatically)
export OPENAI_API_KEY="..."

# Anthropic
export APERTA_AI_PROVIDER="anthropic"
export ANTHROPIC_API_KEY="..."
export APERTA_AI_MODEL="your-model-id"

# Google Gemini
export APERTA_AI_PROVIDER="google"
export GOOGLE_API_KEY="..."
export APERTA_AI_MODEL="your-model-id"

# DeepSeek
export APERTA_AI_PROVIDER="deepseek"
export DEEPSEEK_API_KEY="..."
export APERTA_AI_MODEL="your-model-id"

# OpenRouter or Groq
export APERTA_AI_PROVIDER="openrouter" # or groq
export OPENROUTER_API_KEY="..."        # or GROQ_API_KEY
export APERTA_AI_MODEL="provider/model-id"

# Local Ollama — no API key required
export APERTA_AI_PROVIDER="ollama"
export APERTA_AI_MODEL="qwen2.5-coder"

# Any OpenAI-compatible provider
export APERTA_AI_PROVIDER="openai-compatible"
export APERTA_AI_BASE_URL="https://provider.example/v1"
export APERTA_AI_MODEL="provider/model-id"
export APERTA_AI_API_KEY="..."

aperta dashboard
```

`APERTA_AI_MODEL` overrides every provider default. Remote custom endpoints
must use HTTPS; plaintext HTTP is accepted only for loopback model servers.
The evidence bundle is sent to the configured provider only when the user
explicitly clicks **Personalize this debrief**.

The dashboard also provides **Model Settings** for reusable provider profiles.
Profile metadata is stored globally in `~/.aperta/settings.json`, never in a
repository. On macOS, supplied API keys are stored in Keychain and never
returned to the browser; environment variables remain supported for automated
and cross-platform use.

## Repository comprehension explorer

The Repository Map is a navigable tree of Git-visible tracked and untracked
files. Ignored files—including ignored `.env` files—are excluded at the server
boundary. Selecting a file opens a bounded, syntax-highlighted read-only source
view with its confidence, authorship ratio, captured churn, and ownership
history. Binary files are identified without rendering their contents, and
text previews are limited to 1 MB.

## Agent Workbench

The Agent Workbench is Aperta's controlled action plane. An active model profile
can run a bounded implementation loop inside a disposable Git worktree using
repository list, read, search, and write tools plus allowlisted project checks,
detected local-service startup, and localhost HTTP probes. The agent has no
arbitrary shell or remote-network tool and cannot access ignored files,
credential-bearing files, `.git`, or `.comprehension`. Existing files must be
read before they can be rewritten; runs are capped at 48 implementation
actions, 20 writes, 300 KB per file, and 1 MB of total writes.

Alternatively, Aperta can delegate the isolated execution loop to an installed
Cursor Agent, Claude Code, or OpenCode CLI. Aperta still owns the disposable
workspace, exact changed-file capture, verification loop, action record, and
promotion gate. Read-only requests discard unexpected runtime mutations.

Completed runs produce a retained local action record and a syntax-highlighted
patch. Aperta detects allowlisted project checks for Maven, Gradle, Node package
scripts, Python, Go, and Cargo, runs them inside the disposable worktree, and
gives the agent up to three bounded attempts to repair failures. Changes,
verification output, and live activity have separate review surfaces, and a
run with failing checks cannot be promoted. Analysis-only runs use a dedicated
readable response view instead of pretending an empty patch exists.

The source repository remains unchanged until the maintainer checks the
promotion acknowledgement and explicitly applies the patch. Before promotion,
Aperta compares the real repository tree with the run's starting tree and
refuses to apply over newer work. A promoted patch then enters the normal Git
observer, proof, ownership-session, journal, and recall workflow.

Every run also carries a durable execution contract: goal, ordered plan,
constraints, risks, acceptance criteria, evidence status, deterministic
critique, and promotion decision. Aperta records the pre-change project baseline
separately from post-change checks, so a green result cannot hide a repository
that was already failing. Passing generic checks proves project health; it does
not by itself prove the user's requested behavior.

## Skill Contracts

Every run receives a deterministic, provider-neutral Skill Contract before a
model or external runtime acts. The current built-in contracts cover debugging,
project verification, runtime observation, implementation, code explanation,
and repository exploration. Each contract declares:

- the capabilities the runtime may use
- ordered execution phases
- required proof before completion
- learning objectives that feed the understanding loop

Models may refine a plan, but they cannot remove the skill's required proof or
expand its tool authority. The selected skill is visible in the Workbench and
stored as evidence in the Proof Graph.

## Git and universal capture

Aperta's observer tracks stable staged, unstaged, untracked, and committed
changes regardless of whether they came from a human, an IDE, or an agent. The
Git Changes view shows the current working tree independently from captured
learning sessions. Agent attribution is additional evidence, not a requirement
for the comprehension workflow.

## Harness Intelligence

Harness Health turns retained local runs into an improvement loop. It measures
first-pass verification, repair recovery, tool reliability, promotion rate,
provider latency, structured error classes, and an approximate Trusted Keep
Rate for promoted additions that remain in the working repository. Results are
broken down by provider, model, and bounded tool action so model and harness
changes can be compared instead of judged by anecdote.

Telemetry contains run metadata, timings, bounded error messages, and patch-line
survival counts. It is computed locally; Aperta does not export source code,
prompts, credentials, or repository evidence to an analytics service. Unknown
errors are surfaced as harness defects rather than silently folded into an
"agent failed" bucket.

The Impact Graph connects changed and removed code surfaces to repository
callers, imported dependencies, Spring configuration, API entry points, and
tests. It distinguishes structural evidence from unproven behavior and warns
when a saved explanation overlaps code that changed again. The analyzers are
language-specific and pluggable; the current beta starts with Java and
TypeScript rather
than claiming regex can provide compiler-level semantics for every language.

The repository Proof Graph unifies claims from captured changes and agent runs
with the evidence that supports them: selected skills, diffs, checks, runtime
observations, human explanations, and ownership reviews. A claim can be proven,
understood, supported, unproven, stale, or regressed. Later changes invalidate
only connected claims, preserving an auditable answer to both “does this work?”
and “can the maintainer explain it?”

The Proof Engine detects Maven, Gradle, npm, pnpm, or Yarn from project-owned
manifests and wrappers. From the Impact Graph, a developer can explicitly run
the relevant changed tests, retain the bounded result in the append-only local
ledger, and see graph surfaces move from inferred or unproven to proven—or to
regressed when the runner fails. Aperta also keeps uncovered behaviors visible
as proposed probes instead of treating a green test command as universal proof.

## Install and run

Requires Node.js 22.12 or newer and Git.

```sh
npm install --global aperta-cli@beta
```

To develop Aperta itself from source instead:

```sh
git clone https://github.com/Vequan23/aperta.git
cd aperta
npm install
npm test
npm run build
npm link
```

Initialize the repository you want Aperta to track:

```sh
cd /path/to/your/repository
aperta init
aperta status
aperta dashboard
```

`aperta init` starts the universal observer automatically. On macOS it installs
a private per-project login service, so observation returns after login and is
restarted if the process crashes. It captures stable staged, unstaged,
untracked, and committed changes from any coding tool. Manage it explicitly with:

```sh
aperta start
aperta status
aperta stop
```

Changes are grouped after a short quiet period rather than recorded once per
keystroke. Agent adapters add model, prompt, and session provenance when it is
available; unattributed activity remains explicitly unknown.

Every initialized repository is added to the local `~/.aperta/projects.json`
registry. The dashboard project picker can switch between registered
repositories without exposing arbitrary filesystem browsing. Each project keeps
its own ledger, observer, branch state, queue, journal, and ownership history.

For dashboard development with live reload, run `npm run dev` from the cloned
Aperta repository and open the local URL Vite prints.

The standalone Vue marketing site lives in `marketing/` and uses the same Snow
Leopard/Aqua visual language as the product:

```sh
npm run dev:marketing
npm run build:marketing
```

The repository-level `vercel.json` deploys `marketing/dist`, so the repository
can be imported directly into Vercel without additional build configuration.

Automation can avoid interactive prompts with `aperta capture --ai --score 2`.
Interactive use captures authorship and confidence with one keystroke; confidence
times out after 15 seconds and Escape leaves it unrated.

## Recommended agent loop

Wrap the coding agent once and work normally inside it:

```sh
aperta run --intent "Add passwordless login" -- opencode
```

Aperta snapshots the repository before and after the agent session, attributes
only the resulting changes to AI, stores the exact patch as local evidence, and
refuses to record the same change twice. Existing dirty work is not incorrectly
included in the session. If you skip the confidence prompt, the change appears
in the dashboard review queue.

For non-interactive agents or scripts:

```sh
aperta run --intent "Repair CSV export" --score 2 -- your-agent-command --flags
```

## Data

Aperta keeps repository identity separate from private developer memory. The
repository contains only a safe pointer:

```text
.comprehension/
├── project.json
└── .gitignore
```

Raw prompts, agent transcripts, explanations, learning answers, diffs, logs,
observer state, and the append-only evidence ledger live under:

```text
~/.aperta/repositories/<project-id>/
├── config.json
├── ledger.jsonl
└── cache/
```

This private directory is outside the Git working tree. Initializing an older
Aperta repository migrates its existing config, ledger, and cache without
discarding history. `aperta init` and `aperta doctor` warn when legacy private
files are still Git-tracked so the developer can commit their deletion and
audit earlier repository history before sharing it.

The ledger remains append-only and integrity-chained. Each line is one intent,
diff, confidence, explanation, ownership-evidence, proof, probe, review,
session-complete, or gate-bypass event. From the Review Queue, an ownership
session constructs a risk-ranked Change Story, shows the exact diff, collects
evidence-linked reasoning, and distinguishes demonstrated ownership from a
self-reported confidence claim without pretending an LLM can grade prose.

Every completed ownership session enters the Learning Journal and leaves the
immediate review queue, including an honest low-confidence session with evidence
but no separate prose note. Future session evidence, rating, explanation, and
completion records are appended as one durable ledger operation.

## Trust Kernel and semantic adapters

Aperta labels every graph claim as Git-observed, structurally inferred,
compiler-resolved, or runtime-proven. The JDK compiler adapter resolves
project-local Java symbols and call targets with annotation processing disabled.
The TypeScript compiler adapter covers JavaScript, TypeScript, JSX/TSX, and the
script portions of Vue single-file components. Compiler diagnostics downgrade
semantic coverage to partial instead of hiding missing dependencies or invalid
project configuration. Aperta builds with the native TypeScript 7 compiler and
uses Microsoft's TypeScript 6 compatibility API for embedded semantic analysis
until TypeScript 7 exposes its replacement API. Other languages retain the
universal Git-level workflow without invented symbol or call-graph certainty.

## MVP beta workflow

The 1.0 beta separates immediate change review from scheduled retrieval practice
in **Learn Next**. Completed sessions return after one, three, or seven days
based on confidence, and return immediately when a later capture touches the
same files. Proofs and probes run as visible cancelable jobs with a minimized
environment, bounded output, secret redaction, and explicit disclosure that the
disposable project copy is not network isolation. A successful Maven proof also
caches the resolved dependency classpath for deeper subsequent Java analysis.

Ledger writes are serialized across Aperta processes, runtime-validated, and
integrity-chained. Existing records remain readable as legacy entries. Run
`aperta doctor` from a tracked repository to check its observer, ledger,
semantic adapter, and release readiness. The installed CLI runs compiled
JavaScript; experimental TypeScript execution is used only by the source test
suite.

## Probe Lab

Aperta turns unproven Impact Graph paths into previewable executable
probes. A probe is selected by stable ID from Aperta's repository-aware catalog;
the browser never supplies source code or a command. Aperta copies the project
into a disposable directory, injects the generated test only there, runs the
allowlisted test runner, deletes the copy, and retains a bounded result plus a
hash of the generated source in the local ledger. Proven or disproven probes
update the graph verdicts. The first executable provider covers Spring Security
JWT expiry, issuer, and signature validation; endpoint authorization remains
explicitly blocked until a concrete protected route exists.

Diff evidence and generated probe previews use a safe token renderer with
language-aware highlighting for Java, TypeScript/JavaScript, JSON, XML, YAML,
properties, TOML, and shell-like files. Source is rendered as text tokens—not
injected HTML—so highlighting does not expand the dashboard's trust boundary.

## Security and contributing

Aperta operates close to source code, credentials, local services, and external
agent runtimes. Read [SECURITY.md](SECURITY.md) before deploying it in a shared
or sensitive environment. Please report vulnerabilities privately through
GitHub Security Advisories rather than a public issue.

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the
development workflow, trust-boundary expectations, and pull-request checks.
Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
