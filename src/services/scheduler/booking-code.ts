const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const BOOKING_CODE_PATTERN = /^[A-Z]{2}-[A-Z][0-9]{3}$/;
const INCOMPLETE_BOOKING_CODE_PATTERN = /^[A-Z]{2}-[0-9]{4}$/;
const SPOKEN_CODE_WORDS: Record<string, string> = {
  ZERO: "0",
  OH: "0",
  ONE: "1",
  WON: "1",
  TWO: "2",
  TO: "2",
  TOO: "2",
  THREE: "3",
  FOUR: "4",
  FOR: "4",
  FIVE: "5",
  SIX: "6",
  SEVEN: "7",
  EIGHT: "8",
  ATE: "8",
  NINE: "9",
  TEN: "10",
  ELEVEN: "11",
  TWELVE: "12",
  THIRTEEN: "13",
  FOURTEEN: "14",
  FIFTEEN: "15",
  SIXTEEN: "16",
  SEVENTEEN: "17",
  EIGHTEEN: "18",
  NINETEEN: "19",
  ALPHA: "A",
  AYE: "A",
  AY: "A",
  HEY: "A",
  BRAVO: "B",
  BEE: "B",
  BE: "B",
  CHARLIE: "C",
  SEE: "C",
  SEA: "C",
  DELTA: "D",
  DEE: "D",
  ECHO: "E",
  FOXTROT: "F",
  GOLF: "G",
  HOTEL: "H",
  INDIA: "I",
  EYE: "I",
  I: "I",
  JULIET: "J",
  JULIETT: "J",
  JAY: "J",
  KILO: "K",
  LIMA: "L",
  ELL: "L",
  EL: "L",
  MIKE: "M",
  NOVEMBER: "N",
  EN: "N",
  OSCAR: "O",
  PAPA: "P",
  QUEBEC: "Q",
  QUEUE: "Q",
  CUE: "Q",
  ROMEO: "R",
  SIERRA: "S",
  TANGO: "T",
  UNIFORM: "U",
  VICTOR: "V",
  WHISKEY: "W",
  WHISKY: "W",
  XRAY: "X",
  X_RAY: "X",
  YANKEE: "Y",
  WHY: "Y",
  WYE: "Y",
  ZULU: "Z",
  ZED: "Z",
  ZEE: "Z"
};
const TENS_WORDS: Record<string, string> = {
  TWENTY: "2",
  THIRTY: "3",
  FORTY: "4",
  FOURTY: "4",
  FIFTY: "5",
  SIXTY: "6",
  SEVENTY: "7",
  EIGHTY: "8",
  NINETY: "9"
};

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

export function isIncompleteBookingCode(bookingCode: string) {
  return INCOMPLETE_BOOKING_CODE_PATTERN.test(bookingCode);
}

/**
 * Recover XX-X999 from messy voice/STT text (e.g. "R GDashY133.", "NL A742", "it's NL-A742").
 */
export function parseBookingCodeFromLooseInput(input: string): string | null {
  const direct = parseBookingCodeCandidate(input);
  if (direct) return direct;

  const spoken = normalizeSpokenBookingCode(input);
  if (spoken !== input) {
    return parseBookingCodeCandidate(spoken);
  }

  return null;
}

export function parseIncompleteBookingCodeFromLooseInput(input: string): string | null {
  const direct = parseIncompleteBookingCodeCandidate(input);
  if (direct) return direct;

  const spoken = normalizeSpokenBookingCode(input);
  if (spoken !== input) {
    return parseIncompleteBookingCodeCandidate(spoken);
  }

  return null;
}

function parseBookingCodeCandidate(input: string): string | null {
  let s = input.toUpperCase().trim();
  s = normalizeBookingCodeCandidateText(s);

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

function parseIncompleteBookingCodeCandidate(input: string): string | null {
  const s = normalizeBookingCodeCandidateText(input.toUpperCase().trim());

  const hyphenated = s.match(/[A-Z]{2}-\d{4}/g);
  if (hyphenated) {
    for (const c of hyphenated) {
      if (isIncompleteBookingCode(c)) return c;
    }
  }

  const compact = s.match(/[A-Z]{2}\d{4}/g);
  if (compact) {
    for (const raw of compact) {
      const inner = /^([A-Z]{2})(\d{4})$/.exec(raw);
      if (!inner) continue;
      const code = `${inner[1]}-${inner[2]}`;
      if (isIncompleteBookingCode(code)) return code;
    }
  }

  return null;
}

function normalizeBookingCodeCandidateText(input: string) {
  let s = input;
  s = s.replace(/\s*(?:DASH|HYPHEN|MINUS)\s*/gi, "-");
  s = s.replace(/DASH/gi, "-");
  s = s.replace(/[^A-Z0-9-]/g, "");
  s = s.replace(/-+/g, "-");
  return s;
}

function normalizeSpokenBookingCode(input: string) {
  let s = input.toUpperCase();

  s = s.replace(
    /\b(TWENTY|THIRTY|FORTY|FOURTY|FIFTY|SIXTY|SEVENTY|EIGHTY|NINETY)(?:[\s-]+(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE))?\b/g,
    (_match, tens: string, ones?: string) => `${TENS_WORDS[tens]}${ones ? SPOKEN_CODE_WORDS[ones] : "0"}`
  );

  s = s.replace(/\bX[\s-]?RAY\b/g, "X");
  s = s.replace(/\b([A-Z]+)\b/g, (word) => SPOKEN_CODE_WORDS[word] ?? word);

  return s;
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
