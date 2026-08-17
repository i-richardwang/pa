# Security Policy

## Reporting a vulnerability

Please do not open a public issue for authentication bypasses, authorization errors, record-projection leaks, secret exposure, or other vulnerabilities that could put a deployment at risk.

Use the repository host's private vulnerability reporting channel when it is enabled. If it is unavailable, contact the maintainers through a private channel listed on their repository profile and include:

- the affected version or commit;
- the deployment mode and relevant configuration, with secrets removed;
- minimal reproduction steps;
- the expected and observed security boundary;
- an assessment of impact.

Do not attach real employee records, private semantic packages, access tokens, database files, or production logs. A maintainer will acknowledge the report and coordinate disclosure after a fix is available.

## Supported versions

PA is currently pre-1.0. Security fixes are made on the latest public mainline; older snapshots are not maintained as separate supported release lines.

## Deployment boundary

The public Demo is for local evaluation. A production deployment must enable authentication, restrict allowed origins and network exposure, configure Cube access policies, protect application storage, and review its external semantic package independently. `PA_ALLOW_OPEN=1` is not a production setting.
