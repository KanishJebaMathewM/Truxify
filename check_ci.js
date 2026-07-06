const branches = ['feature/redis-distributed-lock', 'feature/optimistic-locking', 'feature/mongo-bulk-inserts', 'feature/dlq-push-notifications'];
async function check() {
  for (const branch of branches) {
    const res = await fetch(`https://api.github.com/repos/saidai-bhuvanesh/Truxify/commits/${branch}/check-runs`);
    const data = await res.json();
    console.log(`Branch: ${branch}`);
    if (data.check_runs) {
      if (data.check_runs.length === 0) {
        console.log('  No check runs found (could be GitHub Actions is disabled on the fork).');
      } else {
        data.check_runs.forEach(run => {
          console.log(`  - ${run.name}: ${run.status} (${run.conclusion || 'pending'})`);
        });
      }
    } else {
      console.log('  API error: ' + JSON.stringify(data));
    }
  }
}
check();
