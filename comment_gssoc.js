import { execSync } from 'child_process';

const prs = Array.from({length: 18}, (_, i) => 2061 + i);

for (const pr of prs) {
  try {
    console.log(`Commenting on PR #${pr}...`);
    execSync(`gh pr comment ${pr} --body "GSSOC"`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Failed to comment on PR #${pr}: ${err.message}`);
  }
}
