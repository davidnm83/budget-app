/** Web: opens the browser's file picker and resolves with the chosen file's text (null if cancelled). */
export function pickCsvText(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve({ name: file.name, text: await file.text() }); } catch (e) { reject(e); }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const canPickFiles = true;
