# v0.5.0-rc40

RC40 retains the [RC39 map improvements](release-notes-0.5.0-rc39.md) and adds
completion verification for firmware that clears live coverage goals after a
cleaning session ends.

When the live goal container is absent, the integration can verify the retained
goals in the exact completed native session's history. Verification still
requires the original goal identities and settings, the matching session and
floor, an inactive robot, and two consistent observations. Missing, ambiguous
or changed evidence keeps periodic coverage due. A contradictory live goal
list cannot be overridden by history.

This is a prerelease. Preserve a verified Home Assistant backup and the installed
integration and configuration stores before updating; follow the
[rollback guidance](verification-0.5-rc24.md). Installed and physical qualification
remain separate from source tests and review.
