import SHA256 from 'crypto-js/sha256.js';
export class StatusError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const generateShortUniqueId = (title, url) => {
  const hash = SHA256(title + url).toString(); // Full 64-char hash
  return hash.slice(0, 16); // Trim to 16 characters
}