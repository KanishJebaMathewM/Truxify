class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = 400;
  }
}

module.exports = DomainError;
