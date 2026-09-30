"""Replay the trusted native review router's timestamp and failure boundaries."""

import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HEAD = "a" * 40
AT = "2026-09-12T12:00:00Z"
BODY = "Codex Review: No issues found."


class NativeReviewRouterTests(unittest.TestCase):
    def replay(self, *, invalidated=True, graph_fail=False, changed=None):
        workflow = (ROOT / ".github/workflows/review-regular-review.yml").read_text()
        block = workflow.split(
            "      - name: Revoke the regular gate under its per-PR lock", 1
        )[1]
        script = textwrap.dedent(block.split("        run: |\n", 1)[1])
        rest = {
            "id": 17,
            "node_id": "PRR_17",
            "commit_id": HEAD,
            "state": "COMMENTED",
            "body": BODY,
            "user": {
                "id": 199175422,
                "login": "chatgpt-codex-connector[bot]",
                "type": "Bot",
            },
        }
        node = {
            "databaseId": 17,
            "updatedAt": AT,
            "state": "COMMENTED",
            "body": BODY,
            "commit": {"oid": HEAD},
            "author": {"login": "chatgpt-codex-connector", "id": "BOT_kgDOC98s_g"},
            "pullRequest": {"number": 7, "repository": {"nameWithOwner": "acme/repo"}},
        }
        if changed:
            node.update(changed)
        prelude = """gh() {
          printf '%s\n' "$*" >> "$CALLS"
          case "$*" in
            *'api repos/acme/repo/pulls/7/reviews/17'*) printf '%s' "$REST" ;;
            *'api graphql'*)
              [[ "$GRAPH_FAIL" != true ]] || return 1
              printf '%s' "$GRAPH"
              ;;
          esac
        }
        """
        with tempfile.TemporaryDirectory() as tmp:
            calls = Path(tmp) / "calls"
            env = dict(
                os.environ,
                CALLS=str(calls),
                REST=json.dumps(rest),
                GRAPH=json.dumps({"data": {"node": node}}),
                GRAPH_FAIL=str(graph_fail).lower(),
                PR_NUMBER="7",
                REVIEW_ID="17",
                EVENT_HEAD_SHA=HEAD,
                EVENT_REVIEW_COMMIT_SHA=HEAD,
                EVENT_REVIEW_AUTHOR=rest["user"]["login"],
                EVENT_REVIEW_BODY=BODY,
                EVENT_ACTION="edited",
                REVIEW_INVALIDATED=str(invalidated).lower(),
                REPO="acme/repo",
                WORKFLOW_REF="main",
                REVIEW_GATE_CONTEXT="review-gate",
                REVIEW_REVIEW_CONTEXT="review-gate-regular-review",
                GITHUB_SERVER_URL="https://github.com",
                GITHUB_RUN_ID="999",
            )
            result = subprocess.run(
                ["bash"],
                input=prelude + script,
                env=env,
                text=True,
                capture_output=True,
            )
            return result, calls.read_text()

    def test_invalidation_uses_authenticated_review_update_time(self):
        result, calls = self.replay()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            f"Regular review invalidated at {AT}; PR #7; withdrawn review:17", calls
        )
        self.assertLess(calls.index("context=review-gate "), calls.index("api graphql"))
        self.assertIn("workflow run review-gate.yml", calls)

    def test_graphql_failure_leaves_only_main_gate_pending(self):
        result, calls = self.replay(graph_fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("context=review-gate ", calls)
        self.assertNotIn("context=review-gate-regular-review", calls)
        self.assertNotIn("workflow run", calls)

    def test_mismatched_graphql_review_cannot_supply_timestamp(self):
        for changed in (
            {"databaseId": 18},
            {"body": "changed"},
            {"state": "DISMISSED"},
            {"commit": {"oid": "b" * 40}},
            {"author": {"login": "other", "id": "OTHER"}},
            {
                "pullRequest": {
                    "number": 8,
                    "repository": {"nameWithOwner": "acme/repo"},
                }
            },
        ):
            with self.subTest(changed=changed):
                result, calls = self.replay(changed=changed)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("context=review-gate-regular-review", calls)
                self.assertNotIn("workflow run", calls)

    def test_clean_review_does_not_create_invalidation_watermark(self):
        result, calls = self.replay(invalidated=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("api graphql", calls)
        self.assertNotIn("context=review-gate-regular-review", calls)
        self.assertIn("workflow run review-gate.yml", calls)


if __name__ == "__main__":
    unittest.main()
