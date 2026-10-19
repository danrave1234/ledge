# Security policy

Please report vulnerabilities privately through GitHub Security Advisories. Do
not open a public issue with credentials, screenshots, OAuth tokens, or a working exploit.

Only the latest release is supported. API keys, Spotify refresh tokens, and the
optional YouTube key belong in Windows Credential Manager. Ledge never needs an
updater private key at runtime; release signing secrets must remain in the CI
secret store or a local ignored file.

For a report, include the affected version, impact, reproduction steps, and any
suggested mitigation. You can expect an initial acknowledgement within seven days.
