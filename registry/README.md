# registry/

Registry metadata the moss app reads.

## `revoked.json` — the kill switch

The one way to reach plugins already installed on users' machines. moss fetches
it alongside the index and refuses to load any listed version, badging it in the
catalog with the reason.

```json
{
  "schema_version": 1,
  "serial": 7,
  "revocations": [
    {
      "id": "example",
      "versions": ["1.1.0", "1.1.1"],
      "reason": "Exfiltrated vault contents via an undisclosed endpoint.",
      "advisory_url": "https://github.com/Symbiosis-Lab/moss-plugins/security/advisories/..."
    }
  ]
}
```

- `versions` is an explicit list, or `"*"` to revoke every version of that id.
- `reason` is shown to users verbatim. Write it for a writer, not an engineer.
- **`serial` must be incremented on every change.** Clients keep the highest
  serial they have seen and reject anything lower, so a stale copy cannot be
  replayed to un-revoke a bad version. CI rejects a PR that edits this file
  without raising the serial.

Revocation is *not* retroactive deletion: also delete the release assets for the
revoked versions, so a replayed index entry resolves to nothing.

## `index.json`

Not committed. It is generated on merge from the set of existing release tags
(with each zip's sha256) and published to GitHub Pages, so it always describes
what has actually been released rather than what someone hand-edited.
