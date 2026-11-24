test('selectLabels skips new type labels when PR already has one', () => {
  const labels = selectLabels({
    prTitle: 'fix: security issue in docs',
    changedFiles: ['docs/SECURITY.md'],
    linkedIssueLabels: [],
    currentLabels: ['type:bug'],
    availableLabels
  });

  // Do not add another type label when the PR already has type:bug
  assert.equal(
    labels.some(label => label.startsWith('type:')),
    false
  );
});
