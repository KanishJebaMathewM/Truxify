import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, '.tmpcheck')
from issue_specs import SPECS

REPO = 'KanishJebaMathewM/Truxify'
BASE = 'origin/main'
created = {}
for line in Path('.tmpcheck/created.tsv').read_text().splitlines():
    parts = line.split('\t')
    if len(parts) >= 5:
        created[parts[0]] = parts

prs = {}
if Path('.tmpcheck/prs.tsv').exists():
    for line in Path('.tmpcheck/prs.tsv').read_text().splitlines():
        parts = line.split('\t')
        if len(parts) >= 6:
            prs[parts[0]] = parts

body_dir = Path('.tmpcheck/pr-bodies')
body_dir.mkdir(exist_ok=True)


def pr_body(spec, issue):
    return (
        '## Problem\n\n'
        + spec['problem'].strip()
        + '\n\n## Change\n\n'
        + '\n'.join(f'- {item}' for item in spec['fix'])
        + '\n\n## Verification\n\n'
        + '\n'.join(f'- {item}' for item in spec['verify'])
        + f'\n\nCloses #{issue}\n'
    )


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, **kwargs)


for index, spec in enumerate(SPECS, 1):
    key = spec['key']
    row = created[key]
    issue = row[1]
    if key in prs:
        print(f'[{index:02d}] PR exists #{prs[key][2]} for issue #{issue}')
        continue
    branch = f'fix/b2-{issue}-{key}'
    body_path = body_dir / f'{issue}-{key}.md'
    body_path.write_text(pr_body(spec, issue), encoding='ascii')

    # Always branch from the current upstream main, not from the staging branch.
    result = run(['git', 'switch', '-c', branch, BASE])
    if result.returncode != 0:
        # A previous interrupted run may have left the branch checked out.
        if 'already exists' in (result.stderr + result.stdout):
            result = run(['git', 'switch', branch])
        if result.returncode != 0:
            print(f'[{index:02d}] switch failed\n{result.stdout}\n{result.stderr}')
            raise SystemExit(1)

    # A resumed run may already have cherry-picked this fix. Only apply the
    # commits when the branch is still identical to the base.
    ahead = run(['git', 'rev-list', '--count', f'{BASE}..HEAD'])
    if ahead.returncode != 0:
        print(f'[{index:02d}] could not inspect branch {branch}\n{ahead.stderr}')
        raise SystemExit(1)
    if int(ahead.stdout.strip() or '0') == 0:
        result = run(['git', 'cherry-pick', *spec['commits']])
        if result.returncode != 0:
            print(f'[{index:02d}] cherry-pick failed for {branch}\n{result.stdout}\n{result.stderr}')
            raise SystemExit(1)

    result = run(['git', 'push', '-u', 'fork', branch])
    if result.returncode != 0:
        print(f'[{index:02d}] push failed for {branch}\n{result.stdout}\n{result.stderr}')
        raise SystemExit(1)

    result = run([
        'gh', 'pr', 'create', '--repo', REPO, '--base', 'main',
        '--head', f'Senthil455:{branch}', '--title', spec['title'],
        '--body-file', str(body_path),
    ])
    if result.returncode != 0:
        print(f'[{index:02d}] PR create failed for {branch}\n{result.stdout}\n{result.stderr}')
        raise SystemExit(1)
    url = result.stdout.strip().splitlines()[-1].strip()
    match = re.search(r'/pull/(\d+)$', url)
    if not match:
        print(f'[{index:02d}] could not parse PR URL {url!r}')
        raise SystemExit(1)
    pr_number = match.group(1)
    with Path('.tmpcheck/prs.tsv').open('a') as handle:
        handle.write('\t'.join([key, issue, pr_number, url, branch, spec['title']]) + '\n')
    prs[key] = [key, issue, pr_number, url, branch, spec['title']]
    print(f'[{index:02d}] PR #{pr_number} for issue #{issue} {spec["title"]}')

print('done')
