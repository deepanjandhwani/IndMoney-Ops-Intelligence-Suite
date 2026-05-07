const BOOKING_CODE_PATTERN = /\b([A-Z]{2})-([A-Z])(\d{3})\b/g;
const URL_PATTERN = /https?:\/\/[^\s)]+/g;
const MARKDOWN_BOLD = /\*\*(.*?)\*\*/g;
const MARKDOWN_ITALIC = /\*(.*?)\*/g;
const MARKDOWN_HEADER = /^#{1,6}\s+/gm;
const MARKDOWN_LIST_BULLET = /^[-*]\s+/gm;
const MARKDOWN_NUMBERED_LIST = /^\d+\.\s+/gm;
const MARKDOWN_CODE = /`([^`]+)`/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;

export function formatForVoice(text: string): string {
  let result = text;
  result = result.replace(MARKDOWN_LINK, "$1");
  result = result.replace(MARKDOWN_BOLD, "$1");
  result = result.replace(MARKDOWN_ITALIC, "$1");
  result = result.replace(MARKDOWN_HEADER, "");
  result = result.replace(MARKDOWN_CODE, "$1");
  result = result.replace(MARKDOWN_LIST_BULLET, "");
  result = result.replace(MARKDOWN_NUMBERED_LIST, "");
  result = result.replace(URL_PATTERN, "a secure link");
  result = spellBookingCodes(result);
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

export function buildTtsText(text: string): string {
  let result = formatForVoice(text);
  result = formatTimesForSpeech(result);
  return result;
}

function spellBookingCodes(text: string): string {
  return text.replace(BOOKING_CODE_PATTERN, (_match, prefix: string, letter: string, digits: string) => {
    const spelled = `${prefix.split("").join(" ")} dash ${letter} ${digits.split("").join(" ")}`;
    return spelled;
  });
}

function formatTimesForSpeech(text: string): string {
  return text.replace(
    /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)\s*IST/g,
    (_match, hour: string, minute: string, ampm: string) => {
      const minuteText = minute === "00" ? "" : ` ${minute}`;
      return `${hour}${minuteText} ${ampm.toUpperCase()} IST`;
    }
  );
}
