# 0.3.10

Released: 2026-08-20

- Uses native partial or completed room results to improve rotation fairness, including cleaning started outside Home Assistant.
- Keeps last-cleaned timestamps, duration samples, and completion counts tied to verified managed results.
- Ignores unreadable firmware versions instead of reporting false updates.

Existing historical completion timestamps are retained.
