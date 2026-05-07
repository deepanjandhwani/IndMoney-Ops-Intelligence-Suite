import {
  addCustomerAttendee,
  appendSheetRow,
  createAdvisorEmailDraft,
  getEmailDraft,
  sendEmailDraft,
  createCalendarHold,
  readCalendarAvailability,
  updateCalendarEvent,
  updateSheetRowByBookingCode,
  cancelCalendarEvent
} from "../../adapters/google-mcp";
import type {
  AppendSheetRowResult,
  CalendarAvailabilityResult,
  CalendarHoldResult,
  CalendarMutationResult,
  CreateDraftResult,
  GetDraftResult,
  SendDraftResult,
  SheetRowData,
  UpdateSheetRowResult
} from "../../adapters/google-mcp";

export type SchedulerIntegrations = {
  readAvailability: typeof readCalendarAvailability;
  createCalendarHold: typeof createCalendarHold;
  updateCalendarEvent: typeof updateCalendarEvent;
  cancelCalendarEvent: typeof cancelCalendarEvent;
  appendSheetRow: (
    rowData: SheetRowData,
    options?: { spreadsheetId?: string; sheetName?: string }
  ) => Promise<AppendSheetRowResult>;
  updateSheetRowByBookingCode: (
    bookingCode: string,
    updates: Parameters<typeof updateSheetRowByBookingCode>[1],
    options?: Parameters<typeof updateSheetRowByBookingCode>[2]
  ) => Promise<UpdateSheetRowResult>;
  createAdvisorEmailDraft: typeof createAdvisorEmailDraft;
  getEmailDraft: typeof getEmailDraft;
  sendEmailDraft: typeof sendEmailDraft;
  addCustomerAttendee: typeof addCustomerAttendee;
};

export type {
  CalendarAvailabilityResult,
  CalendarHoldResult,
  CalendarMutationResult,
  CreateDraftResult,
  GetDraftResult,
  SendDraftResult,
  SheetRowData,
  UpdateSheetRowResult
};

export function createGoogleSchedulerIntegrations(): SchedulerIntegrations {
  return {
    readAvailability: readCalendarAvailability,
    createCalendarHold,
    updateCalendarEvent,
    cancelCalendarEvent,
    appendSheetRow,
    updateSheetRowByBookingCode,
    createAdvisorEmailDraft,
    getEmailDraft,
    sendEmailDraft,
    addCustomerAttendee
  };
}
