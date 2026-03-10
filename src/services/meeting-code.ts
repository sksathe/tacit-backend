/**
 * Generate a 4-digit meeting code
 * Format: 4-digit number (1000-9999)
 * Example: "1234"
 */
export function generateMeetingCode(): string {
  // Generate random 4-digit number (1000-9999)
  const code = Math.floor(Math.random() * 9000) + 1000;
  return code.toString();
}

/**
 * Normalize meeting code for matching (lowercase, no spaces, no hyphens)
 */
export function normalizeMeetingCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

/**
 * Normalize name for fuzzy matching (lowercase, remove accents, trim)
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}
