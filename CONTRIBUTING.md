# Contributing to PA

PA keeps one public product mainline. Contributions should improve the generic core or the fictional Demo; organization-specific mappings, schemas, terminology, evaluation cases, and deployment overlays belong in an external private semantic package.

## Development setup

```sh
cp .env.example .env
uv run demo/generate_demo_data.py
docker compose up -d --build
cd server
bun install
bun run check
```

The complete check formats and lints TypeScript, shell, and Python sources; type-checks all packages and tests; runs unit and Demo data tests; builds the browser and server artifacts; and checks the open-source boundary.

## Before opening a change

```sh
cd server
bun run check
```

By submitting a contribution, you agree that it is licensed under the repository's Apache License 2.0.
