export { FastMcpUnavailableError, isFastMcpUnavailableError, McpToolExecutionError } from "./errors";

export { getMcpServerUrl, withMcpClient, callMcpToolJson } from "./mcp-session";

export {
  readCalendarAvailability,
  createCalendarHold,
  updateCalendarEvent,
  addCustomerAttendee,
  cancelCalendarEvent
} from "./calendar";
export type {
  CalendarAvailabilityResult,
  CalendarHoldResult,
  CalendarMutationResult
} from "./calendar";

export { appendSheetRow, updateSheetRowByBookingCode, defaultSheetTabName } from "./sheets";
export type { SheetRowData, AppendSheetRowResult, UpdateSheetRowResult } from "./sheets";

export { createAdvisorEmailDraft, getEmailDraft, sendEmailDraft } from "./gmail-drafts";
export type { CreateDraftResult, GetDraftResult, SendDraftResult } from "./gmail-drafts";

/** Tool names implemented by `mcp/groww_ops_mcp_server.py` (Phase 4). */
export const GOOGLE_MCP_TOOL_NAMES = [
  "read_calendar_availability",
  "create_calendar_hold",
  "update_calendar_event",
  "add_customer_attendee",
  "cancel_calendar_event",
  "append_sheet_row",
  "update_sheet_row",
  "create_email_draft",
  "get_email_draft",
  "send_email_draft"
] as const;
