#!/usr/bin/env python3
"""Classify the complete candidate diff, without checking out or executing it.

Exit 0 with a content digest for dependency-only changes, 3 for ordinary review,
or 1 when GitHub cannot provide a complete, stable comparison.
"""
import base64
import configparser
import copy
import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import subprocess
import sys
from urllib.parse import quote

LOCKS = {'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
         'bun.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock',
         'Pipfile.lock', 'Gemfile.lock', 'Podfile.lock', 'Package.resolved',
         'composer.lock', 'packages.lock.json', 'gradle.lockfile', 'pubspec.lock',
         'mix.lock'}
JSON_FIELDS = {'package.json': ['dependencies', 'devDependencies', 'optionalDependencies',
                              'peerDependencies', 'peerDependenciesMeta', 'overrides', 'resolutions'],
               'manifest.json': ['requirements'],
               'composer.json': ['require', 'require-dev']}
SHA = re.compile(r'^[0-9a-f]{40}$')


def only_fields(before, after, fields):
    """At least one dependency field changes and every other field is identical."""
    if not isinstance(before, dict) or not isinstance(after, dict) or before == after:
        return False
    old, new = copy.deepcopy(before), copy.deepcopy(after)
    for field in fields:
        old.pop(field, None)
        new.pop(field, None)
    return old == new


def changed_lines(patch):
    if not patch:
        return None
    old, new = [], []
    for line in patch.splitlines():
        if line.startswith('---') or line.startswith('+++'):
            continue
        if line.startswith('-'):
            old.append(line[1:])
        elif line.startswith('+'):
            new.append(line[1:])
    return old, new


def replacements(patch, pattern, same_group=False):
    lines = changed_lines(patch)
    if lines is None:
        return False
    old, new = lines
    # Do not treat arbitrary step or build-block additions as version updates.
    if not old or len(old) != len(new):
        return False
    pairs = [(re.fullmatch(pattern, a), re.fullmatch(pattern, b)) for a, b in zip(old, new)]
    return all(a and b and (not same_group or a.group(1) == b.group(1)) for a, b in pairs)


def dependency_file(path, before, after, patch, status='modified'):
    """Pure policy. Contents are immutable GitHub blobs, never local PR files."""
    name = PurePosixPath(path).name
    if status not in ('modified', 'added', 'removed') or path.startswith('/') or '..' in PurePosixPath(path).parts:
        return False
    if name in LOCKS or (name == 'verification-metadata.xml' and '/gradle/' in '/' + path):
        return True
    if path.startswith('.github/workflows/') and name.endswith(('.yml', '.yaml')):
        return replacements(patch, r'\s*(?:-\s+)?uses:\s*([\w.-]+/[\w./-]+)@[^\s#]+\s*(?:#.*)?', True)
    if name.startswith('Dockerfile'):
        return replacements(patch, r'\s*FROM\s+(?:--platform=[^\s]+\s+)?([^\s]+)(?:\s+[Aa][Ss]\s+\w+)?\s*(?:#.*)?')
    if status != 'modified' or before is None or after is None:
        return False
    try:
        if name in JSON_FIELDS:
            if name == 'manifest.json' and not path.startswith('custom_components/'):
                return False
            return only_fields(json.loads(before), json.loads(after), JSON_FIELDS[name])
        if name == 'libs.versions.toml' or (name.endswith('.versions.toml') and '/gradle/' in '/' + path):
            import tomllib
            old, new = tomllib.loads(before), tomllib.loads(after)
            allowed = {'versions', 'libraries', 'plugins', 'bundles'}
            return set(old) <= allowed and set(new) <= allowed and old != new
        if name in ('pyproject.toml', 'Cargo.toml', 'Pipfile'):
            import tomllib
            old, new = tomllib.loads(before), tomllib.loads(after)
            original = old != new
            paths = {
                'pyproject.toml': [('project', 'dependencies'), ('project', 'optional-dependencies'),
                                  ('build-system', 'requires'), ('dependency-groups',),
                                  ('tool', 'poetry', 'dependencies'), ('tool', 'poetry', 'dev-dependencies'),
                                  ('tool', 'poetry', 'group')],
                'Cargo.toml': [('dependencies',), ('dev-dependencies',), ('build-dependencies',),
                               ('workspace', 'dependencies')],
                'Pipfile': [('packages',), ('dev-packages',)],
            }[name]
            for data in (old, new):
                for keys in paths:
                    target = data
                    for key in keys[:-1]:
                        target = target.get(key, {}) if isinstance(target, dict) else {}
                    if isinstance(target, dict):
                        target.pop(keys[-1], None)
            return original and old == new
        if name == 'setup.cfg':
            def config(text):
                parser = configparser.ConfigParser(interpolation=None)
                parser.read_string(text)
                return {s: dict(parser[s]) for s in parser.sections()}
            old, new = config(before), config(after)
            changed = old != new
            for data in (old, new):
                for key in ('install_requires', 'setup_requires', 'tests_require'):
                    data.get('options', {}).pop(key, None)
                data.pop('options.extras_require', None)
            return changed and old == new
        if re.fullmatch(r'(?:requirements|constraints)(?:[._-][\w.-]+)?\.(?:txt|in)', name):
            lines = changed_lines(patch)
            if lines is None:
                return False
            # Requirements are declarative package/source constraints, not Python.
            return bool(lines[0] or lines[1]) and all(
                not line.strip() or line.lstrip().startswith('#') or re.fullmatch(
                    r'\s*[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?\s*(?:(?:===|==|~=|!=|<=|>=|<|>)[^;#\n]+)?(?:\s*;[^#\n]+)?(?:\s*#.*)?', line)
                for line in lines[0] + lines[1])
        if name in ('build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'):
            return replacements(patch,
                r'''\s*(?:(?:\w*Implementation|implementation|api|ksp|kapt|classpath|\w*RuntimeOnly|runtimeOnly|compileOnly)\s*\(?["'][\w.+-]+:[\w.+-]+:[^"'\s]+["']\)?|id\(["'][\w.-]+["']\)\s+version\s+["'][\w.+-]+["'](?:\s+apply\s+false)?)\s*(?://.*)?''')
    except (ValueError, TypeError, configparser.Error):
        return False
    return False


def gh(*args):
    cli = os.environ.get('REVIEW_GATE_GH', 'gh')
    result = subprocess.run([cli, 'api', *args], check=True, stdout=subprocess.PIPE)
    return json.loads(result.stdout)


def content(repo, path, ref):
    data = gh(f'repos/{repo}/contents/{quote(path, safe="/")}?ref={ref}')
    if data.get('type') != 'file' or data.get('encoding') != 'base64' or 'content' not in data:
        raise ValueError('GitHub did not return a regular, complete dependency file')
    raw = base64.b64decode(data['content'])
    return raw.decode('utf-8')


def classify(repo, number, head, base):
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not re.fullmatch(r'[1-9][0-9]*', number) or not SHA.fullmatch(head) or not SHA.fullmatch(base):
        raise ValueError('Invalid candidate identity')
    def snapshot():
        pr = gh(f'repos/{repo}/pulls/{number}')
        if pr['state'] != 'open' or pr['head']['sha'] != head or pr['base']['sha'] != base:
            raise ValueError('Candidate changed during dependency classification')
        return pr
    pr = snapshot()
    pages = gh(f'repos/{repo}/pulls/{number}/files?per_page=100', '--paginate', '--slurp')
    files = [item for page in pages for item in page]
    if len(files) != pr['changed_files'] or len({f['filename'] for f in files}) != len(files):
        raise ValueError('Incomplete dependency diff')
    if not files:
        return None
    comparison = gh(f'repos/{repo}/compare/{base}...{head}')
    ancestor = comparison['merge_base_commit']['sha']
    if not SHA.fullmatch(ancestor):
        raise ValueError('Missing immutable merge base')
    records = []
    for file in files:
        path, status = file['filename'], file['status']
        name = PurePosixPath(path).name
        before = after = None
        # Content validation is necessary for manifests with non-dependency keys.
        structured = name in JSON_FIELDS or name in ('pyproject.toml', 'Cargo.toml', 'Pipfile', 'setup.cfg') or name.endswith('.versions.toml')
        if structured and status == 'modified':
            before = content(repo, path, ancestor)
            after = content(pr['head']['repo']['full_name'], path, head)
        if not structured and name not in LOCKS and name != 'verification-metadata.xml':
            lines = changed_lines(file.get('patch'))
            if lines is None or len(lines[0]) != file['deletions'] or len(lines[1]) != file['additions']:
                return None
        if not dependency_file(path, before, after, file.get('patch'), status):
            return None
        records.append({'path': path, 'status': status, 'sha': file['sha'],
                        'patch': file.get('patch'), 'before': before, 'after': after})
    final = snapshot()
    if final['changed_files'] != pr['changed_files'] or final['base']['ref'] != pr['base']['ref'] or final['draft'] != pr['draft']:
        raise ValueError('Candidate changed during dependency classification')
    return hashlib.sha256(json.dumps([repo, number, head, base, records], sort_keys=True).encode()).hexdigest()


def main():
    try:
        digest = classify(os.environ['REPO'], os.environ['PR_NUMBER'], os.environ['HEAD_SHA'], os.environ['BASE_SHA'])
        if digest is None:
            return 3
        print(digest)
        return 0
    except (KeyError, ValueError, UnicodeError, subprocess.CalledProcessError) as error:
        print('Dependency classification failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
