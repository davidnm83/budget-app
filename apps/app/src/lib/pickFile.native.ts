/** The native app doesn't have a file picker yet; CSV import works in the web app (including on your phone). */
export async function pickCsvText(): Promise<{ name: string; text: string } | null> {
  throw new Error('CSV import is only in the web version for now. Open the app in a browser to import.');
}

export async function pickCsvTexts(): Promise<{ name: string; text: string }[]> {
  throw new Error('CSV import is only in the web version for now. Open the app in a browser to import.');
}

export async function pickJsonText(): Promise<{ name: string; text: string } | null> {
  throw new Error('Restore is only in the web version for now. Open the app in a browser to restore.');
}

export const canPickFiles = false;
