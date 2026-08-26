<h1 align="center">Aperta</h1>

<p align="center"><strong>Own the code AI writes.</strong></p>

<p align="center">
  Aperta captures each code change, runs project checks, connects claims to
  evidence, and helps you explain the result before it reaches your main branch.
</p>

<p align="center">
  <a href="https://aperta-six.vercel.app/">Website</a> ·
  <a href="https://www.npmjs.com/package/aperta-cli">npm</a> ·
  <a href="https://github.com/Vequan23/aperta/issues">Issues</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aperta-cli"><img alt="npm beta" src="https://img.shields.io/npm/v/aperta-cli/beta?label=npm%20beta&color=1686cc"></a>
  <a href="https://github.com/Vequan23/aperta/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Vequan23/aperta/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Node 24 LTS recommended" src="https://img.shields.io/badge/node-24%20LTS%20recommended-3c873a">
</p>

> [!IMPORTANT]
> **Public beta:** Aperta is ready for evaluation on real local projects. Its
> interfaces and evidence schema may evolve before the first stable release.

## AI can write the patch. You still own the result.

AI agents can produce a convincing patch in minutes. They do not automatically
give a maintainer the evidence or understanding needed to safely own that patch
for years.

Aperta closes that gap. It is a local review and learning system that:

- captures staged, unstaged, untracked, human, and agent-authored changes;
- runs agent work in disposable Git worktrees instead of your live repository;
- verifies results with project checks, runtime observations, and bounded probes;
- connects claims, code, tests, actions, and human understanding in a Proof Graph;
- turns risky changes into focused ownership reviews and scheduled recall; and
- keeps private developer memory outside the repository by default.

**Aperta does not grade prose or pretend an LLM can certify understanding.** It
records evidence, exposes uncertainty, and leaves the final judgment with the
person responsible for the software.

If that is the future you want for AI-assisted development, consider starring
the repository. It helps other builders find the project.

## Try it in 60 seconds

Requires Git and a supported Node.js LTS release. **Node 24 LTS is recommended**;
Node 22.12 or newer remains supported through its maintenance window.

```sh
npm install --global aperta-cli@beta

cd /path/to/your/repository
aperta init
aperta dashboard
```

`aperta init` starts the local observer. The dashboard opens a repository
workspace containing Agent Work, Git Changes, Changes to Review, the Proof
Graph, Review Notes, and Agent Reliability.

Run an existing coding agent through Aperta:

```sh
aperta run --intent "Add passwordless login" -- opencode
```

Or use Aperta Native from Agent Work. The patch remains isolated until
you review its changes and evidence and explicitly promote it.

## The trust and learning loop

```mermaid
flowchart LR
  change["Any code change"] --> capture["Capture the exact diff"]
  capture --> impact["Map impact and risk"]
  impact --> verify["Run checks and probes"]
  verify --> graph["Update the Proof Graph"]
  graph --> own["Demonstrate ownership"]
  own --> journal["Retain and revisit knowledge"]
  journal --> change
```

Every later change can invalidate only the claims it touches. Aperta preserves
useful evidence while making stale certainty visible.

## Why this is not just another agent wrapper

| | Typical coding-agent loop | Aperta |
| --- | --- | --- |
| Primary goal | Produce a plausible answer or patch | Produce reviewable code, proof, and understanding |
| Workspace | Often edits the live tree | Uses a disposable Git worktree until promotion |
| Verification | Agent reports success | Aperta runs deterministic checks and captures output |
| Trust | Model evaluates its own work | Aperta owns the promotion gate and evidence model |
| Memory | Conversation history | Local repository evidence and a Proof Graph |
| Learning | Incidental | Changes to Review, Review Again, and saved notes |
| Provider choice | Commonly coupled to one vendor | Model- and runtime-neutral |
| Privacy | Often cloud-first | Private per-user storage outside Git |

## What you get

### Agent work you can review

Persistent, multi-turn agent conversations with plans, bounded tools, readable
activity, syntax-highlighted responses, isolated patches, checks, repair loops,
and explicit promotion. Read-only requests discard unexpected runtime changes.

### Universal change capture

Aperta observes stable Git-visible changes regardless of whether they came from
a human, editor, script, or agent. Attribution adds evidence; it is never a
requirement for review.

### Behavioral Proof Graph

The graph connects behavior claims to implementation files, tests, runtime
observations, selected skill contracts, agent actions, explanations, and human
ownership evidence. Claims remain visibly **proven**, **understood**,
**supported**, **unproven**, **stale**, or **regressed**.

### Reviews that return when needed

Changes to Review turns a captured change into a risk-ranked summary. Ownership
reviews ask about the code path, failure modes, evidence, and debugging steps.
Completed reviews enter Review Notes and return through Review Again after one,
three, or seven days. They return sooner when connected code changes.

### Agent reliability

Agent Reliability measures first-pass verification, repair recovery, tool
reliability, promotion rate, provider latency, structured error classes, and an
approximate Trusted Keep Rate. Aperta defects stay separate from model,
tool, and project failures.

## Models reason. Runtimes execute. Aperta owns trust.

Aperta intentionally separates these responsibilities:

| Layer | Responsibility | Current support |
| --- | --- | --- |
| **Model APIs** | Planning, reasoning, explanation, coaching | OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Groq, Ollama, LM Studio, OpenAI-compatible endpoints |
| **Agent runtimes** | Repository inspection, edits, and tool execution | Aperta Native, Claude Code, OpenCode, Cursor Agent |
| **Aperta** | Skill selection, capabilities, isolation, verification, promotion, evidence, and learning | Local trust and evidence layer |

Changing the model or runtime never gives it authority to declare its own work
correct, proven, or understood.

## Private by architecture

The repository stores only a non-sensitive identity pointer:

```text
.comprehension/
├── project.json
└── .gitignore
```

Private developer memory lives outside the Git working tree:

```text
~/.aperta/repositories/<project-id>/
├── config.json
├── ledger.jsonl
└── cache/
```

Raw prompts, transcripts, explanations, learning answers, diffs, logs, and the
integrity-chained evidence ledger are not team-visible repository files. Model
credentials never enter project memory. On macOS, keys entered in Model
Settings are stored in Keychain and are never returned to the browser.

Evidence is sent to a configured provider only for an explicit model action.
Aperta does not export source, prompts, credentials, or repository evidence to
an analytics service.

## Safety boundaries

Agent Work has strict safety limits:

- agent edits occur in a disposable Git worktree;
- ignored files, credential-bearing files, `.git`, and `.comprehension` are blocked;
- existing files must be read before they can be rewritten;
- native runs have no arbitrary remote-network tool;
- project commands come from allowlisted, detected checks;
- localhost services and HTTP probes have explicit lifecycle controls;
- output is bounded and common secrets are redacted;
- failing checks block promotion; and
- promotion fails if the real repository changed after the run began.

Aperta currently caps a native implementation run at 48 actions, 20 writes,
300 KB per file, and 1 MB of total writes. These constraints are Aperta policy,
not suggestions sent to the model.

Read [SECURITY.md](SECURITY.md) before using Aperta with a shared or sensitive
repository. Report vulnerabilities privately through GitHub Security
Advisories.

## Language and project support

The universal Git workflow works for any text-based repository. Deeper evidence
is added only where Aperta has a real adapter:

| Capability | Support |
| --- | --- |
| Project checks | Maven, Gradle, npm, pnpm, Yarn, Python, Go, Cargo |
| Semantic analysis | Java; JavaScript/TypeScript; JSX/TSX; Vue SFC scripts |
| Safe syntax rendering | Java, JS/TS, JSON, XML, YAML, properties, TOML, shell-like files |
| Runtime probes | Bounded localhost HTTP and detected local services |
| Executable Probe Lab | Initial Spring Security JWT behaviors |

Unsupported languages stay useful at the Git, diff, review, ownership, and
journal layers. Aperta does not claim regex provides compiler-level certainty.

<details>
<summary><strong>Configure an optional model provider</strong></summary>

The dashboard's **Model Settings** page is the recommended path. Environment
variables are also supported:

```sh
# OpenAI
export OPENAI_API_KEY="..."

# Anthropic
export APERTA_AI_PROVIDER="anthropic"
export ANTHROPIC_API_KEY="..."
export APERTA_AI_MODEL="your-model-id"

# Google Gemini
export APERTA_AI_PROVIDER="google"
export GOOGLE_API_KEY="..."
export APERTA_AI_MODEL="your-model-id"

# DeepSeek, OpenRouter, or Groq
export APERTA_AI_PROVIDER="deepseek" # or openrouter / groq
export DEEPSEEK_API_KEY="..."
export APERTA_AI_MODEL="your-model-id"

# Local Ollama: no API key required
export APERTA_AI_PROVIDER="ollama"
export APERTA_AI_MODEL="qwen2.5-coder"

# Any OpenAI-compatible endpoint
export APERTA_AI_PROVIDER="openai-compatible"
export APERTA_AI_BASE_URL="https://provider.example/v1"
export APERTA_AI_MODEL="provider/model-id"
export APERTA_AI_API_KEY="..."
```

Remote custom endpoints must use HTTPS. Plain HTTP is accepted only for
loopback model servers. `APERTA_AI_MODEL` overrides provider defaults.

</details>

<details>
<summary><strong>Run Aperta from source</strong></summary>

```sh
git clone https://github.com/Vequan23/aperta.git
cd aperta
npm install
npm test
npm run build
npm link
```

Useful commands:

```sh
aperta init       # initialize and start observing the current repository
aperta dashboard  # open the local dashboard
aperta status     # inspect observer and repository state
aperta doctor     # validate observer, ledger, adapters, and release readiness
aperta start      # start the observer explicitly
aperta stop       # stop the observer
```

For dashboard development, run `npm run dev`. The standalone Vue marketing site
lives in `marketing/` and uses the published
[OSX Components](https://github.com/Vequan23/osx-components) package:

```sh
npm run dev:marketing
npm run build:marketing
```

</details>

## Built for builders who want to remain responsible

Aperta is for developers and teams who want the speed of coding agents
without surrendering the ability to explain, verify, maintain, and improve the
software those agents help create.

- Found a bug or rough edge? [Open an issue](https://github.com/Vequan23/aperta/issues).
- Have an idea for the agent runtime or learning loop? Start a discussion in an issue.
- Want to contribute? Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [Code of Conduct](CODE_OF_CONDUCT.md).
- Want to help the project travel? **Star the repository and share the
  [product site](https://aperta-six.vercel.app/).**

## License

MIT © Aperta contributors. See [LICENSE](LICENSE).
