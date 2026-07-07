export function startTimer(label) {
  const id = `${label}_${Date.now()}`;
  console.time(id);
  return id;
}

export function endTimer(id) {
  console.timeEnd(id);
}

export function withTiming(label, fn) {
  const id = startTimer(label);
  try {
    return fn();
  } finally {
    endTimer(id);
  }
}
