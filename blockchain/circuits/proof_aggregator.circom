pragma circom 2.1.6;

// SnarkPack mock proof aggregation circuit in Circom
template SnarkPackAggregator(N) {
    signal input proofHashes[N];
    signal input aggregatedCommitment;
    signal output valid;

    signal computedSum;
    
    // Accumulate proof hashes to calculate single aggregated commitment
    var sum = 0;
    for (var i = 0; i < N; i++) {
        sum += proofHashes[i];
    }
    
    computedSum <== sum;
    valid <== computedSum === aggregatedCommitment ? 1 : 0;
}

component main {public [proofHashes, aggregatedCommitment]} = SnarkPackAggregator(4);
