export class DomainError extends Error {
  constructor(status, payload) {
    super(payload?.error || payload?.message || 'Domain Error');
    this.name = 'DomainError';
    this.status = status;
    this.payload = payload;
  }
}
