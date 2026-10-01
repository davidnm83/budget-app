export interface PlaidLinkButtonProps {
  /** Omit to link a new bank; pass an item_id to fix a connection that needs a new sign-in. */
  itemId?: string;
  title?: string;
  onDone?: (message: string) => void;
  onError?: (message: string) => void;
}
