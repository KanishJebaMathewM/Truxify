import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, '.tmpcheck')
from issue_specs import SPECS

REPO = 'KanishJebaMathewM/Truxify'
OUT = Path('.tmpcheck/created.tsv')
BODY_DIR = Path('.tmpcheck/bodies')
BODY_DIR.mkdir(exist_ok=True)

created = {}
if OUT.exists():
    for line in OUT.read_text().splitlines():
        parts = line.split('\t')
        if len(parts) >= 4:
            created[parts[0]] = parts


def render(spec):
    lines = [
        '## Problem',
        '',
        spec['problem'].strip(),
        '',
        '## Root cause',
        '',
        spec['root'].strip(),
        '',
        '## Impact',
        '',
    ]
    lines += [f'- {item}' for item in spec['impact']]
    lines += ['', '## Proposed fix', '']
    lines += [f'- {item}' for item in spec['fix']]
    lines += ['', '## Verification', '']
    lines += [f'- {item}' for item in spec['verify']]
    lines += ['', 'Request: @Senthil455 please assign this issue.', '']
    return '\n'.join(lines)


for index, spec in enumerate(SPECS, 1):
    key = spec['key']
    if key in created:
        print(f'[{index:02d}] exists #{created[key][1]} {spec["title"]}')
        continue
    body_path = BODY_DIR / f'{index:02d}-{key}.md'
    body_path.write_text(render(spec), encoding='ascii')
    result = subprocess.run(
        ['gh', 'issue', 'create', '--repo', REPO, '--title', spec['title'], '--body-file', str(body_path)],
        text=True, capture_output=True,
    )
    if result.returncode != 0:
        print(f'[{index:02d}] CREATE FAILED {spec["title"]}\n{result.stdout}\n{result.stderr}')
        raise SystemExit(1)
    url = result.stdout.strip().splitlines()[-1].strip()
    match = re.search(r'/issues/(\d+)$', url)
    if not match:
        print(f'[{index:02d}] could not parse issue URL: {url!r}')
        raise SystemExit(1)
    number = match.group(1)
    row = [key, number, url, ','.join(spec['commits']), spec['title']]
    with OUT.open('a') as handle:
        handle.write('\t'.join(row) + '\n')
    created[key] = row
    print(f'[{index:02d}] created #{number} {spec["title"]}')
