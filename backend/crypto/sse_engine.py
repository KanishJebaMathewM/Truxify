# Stub for spec 49
# === Spec 49: index GC ===
def gc_inverted_index(idx, valid):
    r = 0
    for t, p in list(idx.items()):
        o = len(p)
        idx[t] = [d for d in p if d in valid]
        r += o - len(idx[t])
    return r

