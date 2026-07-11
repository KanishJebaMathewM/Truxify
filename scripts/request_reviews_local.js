const owner = 'KanishJebaMathewM';
const repo = 'Truxify';
const reviewer = 'KanishJebaMathewM';
const token = process.argv[2];

if (!token) {
  console.error('Error: Please provide your GitHub Personal Access Token (PAT) as an argument.');
  console.error('Usage: node scripts/request_reviews_local.js <YOUR_GITHUB_TOKEN>');
  process.exit(1);
}

async function run() {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Node-Fetch-Script'
  };

  console.log(`Fetching all open PRs for ${owner}/${repo}...`);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`, { headers });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch PRs: ${response.status} - ${errText}`);
  }

  const openPRs = await response.json();
  console.log(`Found ${openPRs.length} open PR(s). Requesting review from @${reviewer}...`);

  for (const pr of openPRs) {
    if (pr.user.login.toLowerCase() === reviewer.toLowerCase()) {
      console.log(`Skipping PR #${pr.number} because it was opened by @${reviewer} themselves.`);
      continue;
    }

    console.log(`Requesting review for PR #${pr.number}...`);
    const reqResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reviewers: [reviewer] })
    });

    if (reqResponse.ok) {
      console.log(`Successfully requested review from @${reviewer} for PR #${pr.number}`);
    } else {
      const errText = await reqResponse.text();
      console.error(`Failed for PR #${pr.number}: ${reqResponse.status} - ${errText}`);
    }
  }
}

run().catch(err => {
  console.error('Fatal Error:', err);
});
