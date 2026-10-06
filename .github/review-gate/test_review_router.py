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
    def replay(
        self,
        *,
        invalidated=True,
        graph_fail=False,
        changed=None,
        rest_fail=False,
        rest_changed=None,
        dispatch_fail=False,
    ):
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
        if rest_changed:
            rest.update(rest_changed)
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
            *'api repos/acme/repo/pulls/7/reviews/17'*)
              [[ "$REST_FAIL" != true ]] || return 1
              printf '%s' "$REST" ;;
            *'workflow run'*) [[ "$DISPATCH_FAIL" != true ]] || return 1 ;;
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
                REST_FAIL=str(rest_fail).lower(),
                DISPATCH_FAIL=str(dispatch_fail).lower(),
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

    def test_stale_review_deliveries_reconcile_after_pending(self):
        for options in ({"rest_fail": True}, {"rest_changed": {"body": "newer body"}}):
            with self.subTest(options=options):
                result, calls = self.replay(**options)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertLess(
                    calls.index("context=review-gate "), calls.index("workflow run")
                )
                self.assertIn("-F audit=true", calls)
                self.assertNotIn("context=review-gate-regular-review", calls)
                self.assertNotIn("api graphql", calls)

    def test_stale_reconciliation_failure_remains_pending(self):
        result, calls = self.replay(rest_fail=True, dispatch_fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("context=review-gate ", calls)
        self.assertNotIn("state=success", calls)

    def test_clean_review_does_not_create_invalidation_watermark(self):
        result, calls = self.replay(invalidated=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("api graphql", calls)
        self.assertNotIn("context=review-gate-regular-review", calls)
        self.assertIn("workflow run review-gate.yml", calls)


class RegularCommentTests(unittest.TestCase):
    def scripts(self):
        workflow = (ROOT / ".github/workflows/review-regular-comment.yml").read_text()
        classify = workflow.split("      - id: classify\n", 1)[1]
        classify = textwrap.dedent(
            classify.split("        run: |\n", 1)[1].split("\n  bind-request:", 1)[0]
        )
        invalidate = workflow.split(
            "      - name: Revoke the regular gate under its per-PR lock\n", 1
        )[1]
        invalidate = textwrap.dedent(invalidate.split("        run: |\n", 1)[1])
        return classify, invalidate

    def run_classifier(self, body):
        classify, _ = self.scripts()
        pull = {"head": {"sha": HEAD}, "base": {"sha": "b" * 40}}
        prelude = """gh() {
          printf '%s\\n' "$*" >> "$CALLS"
          case "$*" in
            *'/pulls/7'*) printf '%s' "$PULL" ;;
          esac
        }
        """
        with tempfile.TemporaryDirectory() as tmp:
            calls = Path(tmp) / "calls"
            output = Path(tmp) / "output"
            env = dict(
                os.environ,
                CALLS=str(calls),
                GITHUB_OUTPUT=str(output),
                PULL=json.dumps(pull),
                EVENT_COMMENT_AUTHOR="chatgpt-codex-connector[bot]",
                EVENT_COMMENT_BODY=body,
                EVENT_COMMENT_CREATED_AT=AT,
                EVENT_COMMENT_ID="99",
                EVENT_ACTION="created",
                EVENT_PREVIOUS_COMMENT_BODY="",
                GH_TOKEN="test",
                PR_NUMBER="7",
                REPO="acme/repo",
                REVIEW_BOT_EVENT_LOGIN="chatgpt-codex-connector[bot]",
                REVIEW_COMMENT_CONTEXT="review-gate-regular-comment",
                REVIEW_GATE_CONTEXT="review-gate",
            )
            result = subprocess.run(
                ["bash"],
                input=prelude + classify,
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            values = dict(
                line.split("=", 1) for line in output.read_text().splitlines()
            )
            return values

    def run_invalidator(self, body, clean):
        _, invalidate = self.scripts()
        comment = {
            "user": {"login": "chatgpt-codex-connector[bot]"},
            "body": body,
            "updated_at": AT,
        }
        prelude = """gh() {
          printf '%s\\n' "$*" >> "$CALLS"
          case "$*" in
            *'/issues/comments/99'*) printf '%s' "$COMMENT" ;;
            *'workflow run review-gate.yml'*) ;;
            *'contents/.github/workflows/review-gate.yml'*) ;;
          esac
        }
        """
        with tempfile.TemporaryDirectory() as tmp:
            calls = Path(tmp) / "calls"
            env = dict(
                os.environ,
                CALLS=str(calls),
                COMMENT=json.dumps(comment),
                CLEAN=clean,
                EVENT_ACTION="created",
                EVENT_COMMENT_AUTHOR="chatgpt-codex-connector[bot]",
                EVENT_COMMENT_BODY=body,
                EVENT_COMMENT_CREATED_AT=AT,
                EVENT_COMMENT_ID="99",
                EVENT_COMMENT_UPDATED_AT=AT,
                GH_TOKEN="test",
                HEAD_SHA=HEAD,
                PR_NUMBER="7",
                REPO="acme/repo",
                REVIEW_BOT_EVENT_LOGIN="chatgpt-codex-connector[bot]",
                REVIEW_COMMENT_CONTEXT="review-gate-regular-comment",
                REVIEW_GATE_CONTEXT="review-gate",
                WORKFLOW_REF="main",
                GITHUB_RUN_ID="999",
                GITHUB_SERVER_URL="https://github.com",
            )
            result = subprocess.run(
                ["bash"],
                input=prelude + invalidate,
                env=env,
                text=True,
                capture_output=True,
            )
            return result, calls.read_text()

    def clean_body(self, footer):
        return (
            "Codex Review: Didn't find any major issues. 🎉\n"
            f"**Reviewed commit:** `{footer}`\n"
            "<details>\n<summary>About Codex in GitHub</summary>"
        )

    def test_short_current_head_clean_result_does_not_self_invalidate(self):
        body = self.clean_body(HEAD[:10])
        outputs = self.run_classifier(body)
        self.assertEqual(outputs["regular"], "true")
        self.assertEqual(outputs["clean"], "true")
        result, calls = self.run_invalidator(body, outputs["clean"])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("context=review-gate ", calls)
        self.assertNotIn("context=review-gate-regular-comment", calls)

    def test_full_current_head_clean_result_remains_supported(self):
        outputs = self.run_classifier(self.clean_body(HEAD))
        self.assertEqual(outputs["regular"], "true")
        self.assertEqual(outputs["clean"], "true")

    def test_current_head_finding_still_invalidates(self):
        body = (
            "Codex Review: Found a problem.\n[P1] Reproducible regression.\n"
            f"**Reviewed commit:** `{HEAD[:10]}`"
        )
        outputs = self.run_classifier(body)
        self.assertEqual(outputs["regular"], "true")
        self.assertEqual(outputs["clean"], "false")
        result, calls = self.run_invalidator(body, outputs["clean"])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("context=review-gate-regular-comment", calls)

    def test_clean_result_for_different_head_is_not_current(self):
        outputs = self.run_classifier(self.clean_body("c" * 10))
        self.assertEqual(outputs["regular"], "false")
        self.assertEqual(outputs["clean"], "false")


if __name__ == "__main__":
    unittest.main()
