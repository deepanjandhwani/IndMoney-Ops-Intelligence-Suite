import { callMcpToolJson } from "./mcp-session";

export type SheetRowData = {
  date?: string;
  product?: string;
  topic?: string;
  slot?: string;
  booking_code: string;
  weekly_pulse_themes?: string[] | string;
  source?: string;
  approval_status?: string;
  advisor_calendar_status?: string;
  advisor_email_draft_status?: string;
};

export type AppendSheetRowResult = {
  updated_range?: string;
  spreadsheet_url?: string;
};

export type UpdateSheetRowResult =
  | { status: "updated"; row: number; booking_code: string }
  | { status: "not_found"; booking_code: string };

function defaultSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID?.trim();
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID is not set");
  }
  return id;
}

export function defaultSheetTabName(): string {
  return (process.env.GOOGLE_SHEET_TAB || "Bookings").trim();
}

export async function appendSheetRow(
  rowData: SheetRowData,
  options?: { spreadsheetId?: string; sheetName?: string }
): Promise<AppendSheetRowResult> {
  return callMcpToolJson<AppendSheetRowResult>("append_sheet_row", {
    spreadsheet_id: options?.spreadsheetId ?? defaultSpreadsheetId(),
    sheet_name: options?.sheetName ?? defaultSheetTabName(),
    row_data: rowData
  });
}

export async function updateSheetRowByBookingCode(
  bookingCode: string,
  updates: Partial<Record<
    | "approval_status"
    | "advisor_calendar_status"
    | "advisor_email_draft_status"
    | "slot"
    | "topic"
    | "booking_code"
    | "weekly_pulse_themes"
    | "date"
    | "product"
    | "source",
    string | string[]
  >>,
  options?: { spreadsheetId?: string; sheetName?: string }
): Promise<UpdateSheetRowResult> {
  return callMcpToolJson<UpdateSheetRowResult>("update_sheet_row", {
    spreadsheet_id: options?.spreadsheetId ?? defaultSpreadsheetId(),
    sheet_name: options?.sheetName ?? defaultSheetTabName(),
    row_identifier: bookingCode,
    updates
  });
}
