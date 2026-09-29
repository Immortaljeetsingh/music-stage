# Security and privacy

## Local serving

Use `npm start`. The included server binds to `127.0.0.1` by default, serves an explicit allowlist, supports audio byte ranges, and refuses Git metadata, source tests, package files, and loose personal audio. Do not serve the repository root with a generic directory server.

Binding outside loopback is intentionally refused unless `ALLOW_REMOTE=1` is set. Only enable that variable when you understand that other devices may reach the app and its allowlisted demo assets.

## Local and remote data

Audio selected with the file picker is decoded locally and is not uploaded by Music Stage. Project JSON never contains audio samples. Saved separated stems use browser IndexedDB for the current origin.

These optional actions make third-party requests:

- Stem separation loads exact-version modules from jsDelivr and a model from Hugging Face.
- Catalog search contacts Archive.org or Audius.
- Loading a pasted link contacts the URL entered by the user.
- Documentation links navigate to their named external sites.

The UI identifies these boundaries before use. Network loads have protocol, size, timeout, cancellation, and stale-result checks where the browser APIs permit them.

## Browser protections

The local server sends a Content Security Policy, denies framing, disables MIME sniffing, limits powerful features, and applies a no-referrer policy. Main application scripts are local external files; stem runtime modules are pinned to exact package versions.

## Reporting

Please report vulnerabilities privately through the repository's GitHub Security Advisory feature. Do not include copyrighted audio, personal data, credentials, or exploit traffic from systems you do not own or have permission to test.
