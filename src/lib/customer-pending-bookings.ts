/** Fired when the logged-in customer's list of bookings needing action may have changed. */
export const CUSTOMER_PENDING_BOOKINGS_CHANGED_EVENT = "customer-pending-bookings-changed";

export function notifyCustomerPendingBookingsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CUSTOMER_PENDING_BOOKINGS_CHANGED_EVENT));
}
