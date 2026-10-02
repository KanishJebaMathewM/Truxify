/** Native prediction owners remain reserved until transport/body work settles. */
export class OwnedPredictionFlights {
  constructor() {
    this.flights = new Map();
  }

  run(key, operation) {
    const existing = this.flights.get(key);
    if (existing) return existing.callers;
    if (this.flights.size >= 8) {
      return Promise.reject(new Error('[ML] Prediction capacity reached'));
    }

    const controller = new AbortController();
    const flight = {};
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('[ML] Prediction deadline exceeded after 5000ms');
        error.name = 'TimeoutError';
        controller.abort(error);
        reject(error);
      }, 5000);
    });
    const native = Promise.resolve().then(() => operation(controller.signal));
    const settled = native.finally(() => {
      clearTimeout(timer);
      if (this.flights.get(key) === flight) this.flights.delete(key);
    });
    // The caller race may expire first. Only native settlement frees the slot;
    // Promise.race also observes a late rejection after all callers time out.
    flight.callers = Promise.race([settled, deadline]);
    this.flights.set(key, flight);
    return flight.callers;
  }
}
