"""Tests for the self-hosted runner rule in delivery-contract.py."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "delivery_contract", Path(__file__).with_name("delivery-contract.py")
)
contract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(contract)

HEADERS = {
    "ci": (
        "on:\n  pull_request:\n  push:\n    branches: [main]\n"
        "concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n"
    ),
    "dispatch": "on:\n  workflow_dispatch:\n",
}
STEPS = "    steps:\n      - run: true\n"
POOL = "    runs-on: [self-hosted, ephemeral, linux-arm64]\n"
REFUSED = "w.yml: runs-on must be a list containing self-hosted"


def check(kind, job):
    with tempfile.TemporaryDirectory() as root:
        workflows = Path(root, ".github", "workflows")
        workflows.mkdir(parents=True)
        Path(root, ".github", "delivery-contract.json").write_text(
            json.dumps(
                {"workflows": {"w.yml": kind}, "hosted": False, "dependabot": False}
            )
        )
        text = f"name: w\n{HEADERS[kind]}jobs:\n  build:\n{job}"
        (workflows / "w.yml").write_text(text)
        return contract.check(root)


class RunsOnTest(unittest.TestCase):
    def assert_refused(self, job):
        for kind in HEADERS:
            self.assertIn(REFUSED, check(kind, job), kind)

    def test_pool_runner_passes(self):
        for kind in HEADERS:
            self.assertEqual(check(kind, POOL + STEPS), [], kind)

    def test_escaped_runs_on_keys_are_refused(self):
        # YAML decodes each of these keys to runs-on.
        keys = {
            "hex escape": '    "runs-\\x6fn": ubuntu-latest\n',
            "escaped line break": '    "runs-\\\n    on": ubuntu-latest\n',
            "unicode escape": '    "runs-\\u006fn": ubuntu-latest\n',
            "explicit key": '    ? "runs-\\x6fn"\n    : ubuntu-latest\n',
            "explicit key on its own line": (
                '    ?\n      "runs-\\x6fn"\n    : ubuntu-latest\n'
            ),
        }
        for name, key in keys.items():
            with self.subTest(name):
                self.assert_refused(key + STEPS)

    def test_alias_key_is_refused(self):
        self.assert_refused(
            '    env: {K: &k "runs-\\x6fn"}\n    *k : ubuntu-latest\n' + STEPS
        )

    def test_escaped_key_in_a_flow_mapping_is_refused(self):
        flow = '    x: {a: b \'c, "runs-\\x6fn": ubuntu-latest}\n'
        self.assert_refused(POOL + STEPS + flow)

    def test_escaped_key_after_a_run_block_is_refused(self):
        after = (
            '      - run: |\n          echo "$x" \\\n    "runs-\\x6fn": ubuntu-latest\n'
        )
        self.assert_refused(POOL + STEPS + after)

    def test_backslashes_inside_run_blocks_pass(self):
        job = (
            POOL
            + STEPS
            + (
                "      - run: |\n"
                '          printf "%s\\n" "$x" \\\n'
                '            "$y"\n'
                "      - run: >-\n"
                '          echo "a\\": b ? c"\n'
            )
        )
        for kind in HEADERS:
            self.assertEqual(check(kind, job), [], kind)


if __name__ == "__main__":
    unittest.main()
