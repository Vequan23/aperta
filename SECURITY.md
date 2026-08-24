# Security policy

## Supported versions

Aperta is currently a public beta. Security fixes are applied to the newest
published beta only.

| Version | Supported |
| --- | --- |
| `1.0.0-beta.x` | Yes |
| Earlier builds | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
**Security → Report a vulnerability** flow to submit a private GitHub Security
Advisory. Include the affected version, reproduction steps, expected impact,
and any suggested mitigation. Please avoid including real credentials or
private repository contents.

The project will acknowledge a report as soon as practical, investigate it,
and coordinate disclosure after a fix is available. There is currently no paid
bug-bounty program.

## Trust boundaries

Aperta is a local development tool, not a security sandbox.

- Agent runs occur in disposable Git worktrees, but they still execute with the
  operating-system permissions of the user running Aperta.
- Allowlisted checks and local-service commands can execute project-owned code.
- Disposable worktrees isolate repository state; they do not provide network,
  process, container, or filesystem isolation.
- External agent runtimes retain their own authentication, configuration, and
  security behavior.
- Model providers receive context only when the user invokes a configured model
  or runtime. Review provider policies before sending sensitive code.
- Repository evidence and prompts are stored outside Git under `~/.aperta` by
  default. Users remain responsible for protecting that directory and auditing
  legacy history created by older Aperta versions.

Use a dedicated operating-system account, container, or virtual machine when
evaluating untrusted repositories or agents.
