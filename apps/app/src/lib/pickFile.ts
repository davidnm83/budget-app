/** Web: opens the browser's file picker and resolves with the chosen file's text (null if cancelled). */
export function pickCsvText(accept = '.csv,text/csv,text/plain'): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve({ name: file.name, text: await file.text() }); } catch (e) { reject(e); }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Web: like pickCsvText, but several files can be chosen at once. Resolves with [] if cancelled. */
export function pickCsvTexts(): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,text/csv,text/plain';
    input.onchange = async () => {
      try { resolve(await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, text: await f.text() })))); } catch (e) { reject(e); }
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** A backup made by "Download everything". */
export const pickJsonText = () => pickCsvText('.json,application/json');

export const canPickFiles = true;
