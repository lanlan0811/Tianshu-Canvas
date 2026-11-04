# Security Policy

中文版：[SECURITY.md](SECURITY.md)

## Supported versions

Security updates are provided for the **latest release only**. Please upgrade to the latest
version before reporting an issue.

| Version | Supported |
|---|---|
| Latest | Yes |
| Older | No |

## Reporting a vulnerability

**Do not report security vulnerabilities through public issues, pull requests, or discussions.**

Please email **lanaiw2025@163.com** and include as much of the following as possible:

- Description of the vulnerability and its impact
- Steps to reproduce (a minimal reproducible example)
- Affected versions
- Suggested fix (optional)

We will acknowledge and respond as soon as possible. Please keep the details confidential
until a fix is released.

## Security model

The plugin runs a local HTTP server bound to `127.0.0.1` only, used to render the canvas in a
browser. Relevant protections:

- **Loopback only**: the server binds `127.0.0.1` and validates the `Host` header.
- **CSRF protection**: every mutating endpoint requires the custom header
  `X-Tianshu-Canvas: 1`, which cross-origin requests cannot set.
- **Prototypes are treated as untrusted**: prototype HTML is rendered in an iframe with
  `sandbox="allow-scripts"` (no `allow-same-origin`, i.e. an opaque origin) plus a strict CSP
  and `X-Content-Type-Options: nosniff`. The iframe cannot read any canvas state and can only
  communicate via `postMessage`.
- **Path traversal protection**: page ids and export file names are strictly validated,
  disallowing path separators and `..`.
- **Static asset allowlist**: only allowlisted build artifacts are served.

## Scope

**In scope**: unauthorized access to the local server, path traversal, CSRF, prototype content
escaping its sandbox, and prototype injection into the canvas page.

**Out of scope**: third-party scripts that users include in their own prototypes, and
vulnerabilities in the Tianshu host itself (please report those to Tianshu).
