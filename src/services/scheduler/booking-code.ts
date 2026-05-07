const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const BOOKING_CODE_PATTERN = /^[A-Z]{2}-[A-Z][0-9]{3}$/;

export type BookingCodeRepository = {
  bookingCodeExists: (bookingCode: string) => Promise<boolean>;
};

export type GenerateUniqueBookingCodeOptions = {
  maxAttempts?: number;
  codeGenerator?: () => string;
};

export class BookingCodeCollisionError extends Error {
  constructor(attempts: number) {
    super(`Could not generate a unique booking code after ${attempts} attempts.`);
    this.name = "BookingCodeCollisionError";
  }
}

export function generateBookingCode(random: () => number = Math.random) {
  const letters = [
    pick(LETTERS, random),
    pick(LETTERS, random),
    pick(LETTERS, random)
  ];
  const digits = [pick(DIGITS, random), pick(DIGITS, random), pick(DIGITS, random)];

  return `${letters[0]}${letters[1]}-${letters[2]}${digits.join("")}`;
}

export function isValidBookingCode(bookingCode: string) {
  return BOOKING_CODE_PATTERN.test(bookingCode);
}

/**
 * Recover XX-X999 from messy voice/STT text (e.g. "R GDashY133.", "NL A742", "it's NL-A742").
 */
export function parseBookingCodeFromLooseInput(input: string): string | null {
  let s = input.toUpperCase().trim();
  s = s.replace(/\s*(?:DASH|HYPHEN|MINUS)\s*/gi, "-");
  s = s.replace(/DASH/gi, "-");
  s = s.replace(/[^A-Z0-9-]/g, "");
  s = s.replace(/-+/g, "-");

  const hyphenated = s.match(/[A-Z]{2}-[A-Z]\d{3}/g);
  if (hyphenated) {
    for (const c of hyphenated) {
      if (isValidBookingCode(c)) return c;
    }
  }

  const compact = s.match(/[A-Z]{2}[A-Z]\d{3}/g);
  if (compact) {
    for (const raw of compact) {
      const inner = /^([A-Z]{2})([A-Z])(\d{3})$/.exec(raw);
      if (!inner) continue;
      const code = `${inner[1]}-${inner[2]}${inner[3]}`;
      if (isValidBookingCode(code)) return code;
    }
  }

  return null;
}

export async function generateUniqueBookingCode(
  repository: BookingCodeRepository,
  options: GenerateUniqueBookingCodeOptions = {}
) {
  const maxAttempts = options.maxAttempts ?? 5;
  const codeGenerator = options.codeGenerator ?? generateBookingCode;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const bookingCode = codeGenerator();

    if (!isValidBookingCode(bookingCode)) {
      throw new Error(`Generated invalid booking code: ${bookingCode}`);
    }

    if (!(await repository.bookingCodeExists(bookingCode))) {
      return bookingCode;
    }
  }

  throw new BookingCodeCollisionError(maxAttempts);
}

function pick(values: string, random: () => number) {
  const index = Math.floor(random() * values.length);
  return values[Math.min(index, values.length - 1)];
}
