# Contributing to Aperta

Thanks for helping make generated code easier to understand and trust.

## Before starting

- Search existing issues and discussions before proposing substantial work.
- Open an issue for changes that alter the evidence model, trust boundaries,
  storage format, agent authority, or public CLI behavior.
- Never commit prompts, repository evidence, credentials, `.env` files, or data
  from `~/.aperta`.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report security concerns
  through the private process in [SECURITY.md](SECURITY.md).

## Development

Aperta uses Node.js 24 LTS for local development. Run `nvm use` from the
repository root to select the version declared in `.nvmrc`. Node.js 22.12 or
newer remains a supported compatibility target and is validated in CI alongside
Node 24.

```sh
npm ci
npm test
npm run build
npm pack --dry-run
```

The source test suite uses Node's TypeScript type stripping. The distributed CLI
uses the compiled JavaScript in `dist-cli/`; generated build output is not
committed.

## Pull requests

Keep pull requests focused and explain:

1. the user problem being solved;
2. any change to agent authority or a trust boundary;
3. the deterministic evidence that proves the behavior;
4. tests added or updated; and
5. any migration or compatibility impact.

Changes that claim behavior is proven must retain the underlying command,
runtime observation, or human acknowledgement. Model prose alone is not proof.
All CI checks must pass before review.
