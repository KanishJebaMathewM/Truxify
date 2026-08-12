export class EventRegistry {
  constructor() {
    this._eventTypes = new Map();
    this._validators = new Map();
  }

  register(eventType, { source, category = 'domain', description = '', validator = null } = {}) {
    if (!eventType || typeof eventType !== 'string') {
      throw new Error('eventType must be a non-empty string');
    }
    this._eventTypes.set(eventType, { source, category, description });
    if (typeof validator === 'function') {
      this._validators.set(eventType, validator);
    }
    return this;
  }

  isValid(eventType) {
    return this._eventTypes.has(eventType);
  }

  getDefinition(eventType) {
    return this._eventTypes.get(eventType) || null;
  }

  validate(eventType, payload) {
    const definition = this._eventTypes.get(eventType);
    if (!definition) {
      return { valid: false, error: `Unknown event type: ${eventType}` };
    }

    const validator = this._validators.get(eventType);
    if (validator) {
      try {
        const result = validator(payload);
        if (result === true) return { valid: true };
        return { valid: false, error: result || `Validation failed for ${eventType}` };
      } catch (err) {
        return { valid: false, error: `Validation error for ${eventType}: ${err.message}` };
      }
    }

    return { valid: true };
  }

  getRegisteredTypes() {
    return Array.from(this._eventTypes.keys());
  }

  remove(eventType) {
    this._eventTypes.delete(eventType);
    this._validators.delete(eventType);
    return this;
  }
}
