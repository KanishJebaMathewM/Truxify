export class InvalidCursorError extends Error {
  constructor(message = 'Invalid or corrupted pagination cursor') {
    super(message);
    this.name = 'InvalidCursorError';
    this.statusCode = 400;
  }
}
