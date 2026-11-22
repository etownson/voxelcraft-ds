#!/usr/bin/env bash
# Checks that every name the game imports is actually exported by the module it
# comes from, and that no module imports the page. node --check cannot see this:
# a missing export is a link error the browser raises at load time, and with no
# build step there is nothing else to catch it before the page goes blank.
# Usage: ./tools/check-imports.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$DIR" <<'PY'
import glob
import os
import re
import sys

root = sys.argv[1]


def module_script(html):
    match = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    return match.group(1) if match else ''


files = {'index.html': module_script(open(os.path.join(root, 'index.html'), encoding='utf-8').read())}
for path in sorted(glob.glob(os.path.join(root, 'src', '*.js'))):
    files[os.path.relpath(path, root)] = open(path, encoding='utf-8').read()

EXPORT = re.compile(
    r'^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)'
    r'|^export\s*\{([^}]*)\}',
    re.M,
)
IMPORT = re.compile(r'^import\s*(?:[^\'"]*?)\bfrom\s*[\'"]([^\'"]+)[\'"]', re.M | re.S)

exports = {}
for name, text in files.items():
    found = set()
    for match in EXPORT.finditer(text):
        if match.group(1):
            found.add(match.group(1))
        if match.group(2):
            found.update(part.strip().split(' as ')[-1] for part in match.group(2).split(',') if part.strip())
    exports[name] = found

problems = []
for name, text in files.items():
    here = os.path.dirname(name)
    for match in IMPORT.finditer(text):
        clause = match.group(0)
        specifier = match.group(1)
        if not specifier.startswith('.'):
            continue  # a bare specifier is the import map's business, not ours
        target = os.path.normpath(os.path.join(here, specifier)).replace(os.sep, '/')
        if target not in files:
            problems.append(f'{name}: imports {specifier}, which is not a file in the project')
            continue
        if target == 'index.html':
            problems.append(f'{name}: imports the page itself, which is a cycle')
            continue
        braces = re.search(r'\{([^}]*)\}', clause, re.S)
        if not braces:
            continue
        for part in braces.group(1).split(','):
            imported = part.strip().split(' as ')[0].strip()
            if not imported:
                continue
            if imported not in exports[target]:
                problems.append(f'{name}: imports {imported} from {target}, which does not export it')

# The other direction, which is the one that goes wrong when code is moved by
# hand: a file reaches for a name another file exports, but never imports it. That
# is not a syntax error and not a link error, just a ReferenceError the first time
# the line runs, so it can hide until a player walks into it. A name followed
# immediately by a colon is an object key and a name after a dot is a property, so
# neither counts as a reference; the spread dots are blanked out first.
DECL_ANY = re.compile(
    r'(?:^|\s)(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)'
    r'|(?:^|\s)function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\('
)


def references(text):
    code = '\n'.join(
        line for line in text.split('\n') if not re.match(r'^\s*(\*|//|/\*)', line)
    ).replace('...', '   ')
    return code


def bound_names(text):
    found = set()
    for line in text.split('\n'):
        if re.match(r'^\s*(\*|//|/\*)', line):
            continue
        for match in DECL_ANY.finditer(line):
            found.add(match.group(1) or match.group(2))
    return found


for name, text in files.items():
    here = os.path.dirname(name)
    code = references(text)
    local = bound_names(text)
    imported = set()
    for match in IMPORT.finditer(text):
        braces = re.search(r'\{([^}]*)\}', match.group(0), re.S)
        if braces and match.group(1).startswith('.'):
            imported.update(p.strip().split(' as ')[-1].strip() for p in braces.group(1).split(',') if p.strip())
    for source, exported in exports.items():
        if source == name:
            continue
        rel = os.path.relpath(source, here) if here else source
        for exported_name in sorted(exported):
            if exported_name in local or exported_name in imported:
                continue
            if not re.search(r'(?<![.\w$])' + re.escape(exported_name) + r'(?![\w$])(?!:)', code):
                continue
            problems.append(f'{name}: uses {exported_name} from {rel} without importing it')

for problem in problems:
    print(problem)
if problems:
    sys.exit(f'{len(problems)} import problem(s)')

count = sum(len(v) for v in exports.values())
print(f'imports ok: {len(files)} files, {count} exports')
PY
