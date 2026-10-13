import workerUrl from "./route-import.worker.ts?worker&url";
import { importFile } from "./files";
import type { ImportProgress } from "./compact-import";
import type { RouteData } from "./route";
export function importRouteFile(
  file: File,
  progress: (p: ImportProgress) => void,
): Promise<RouteData> {
  if (typeof Worker === "undefined") return importFile(file, progress);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, { type: "module" });
    } catch {
      void importFile(file, progress).then(resolve, reject);
      return;
    }
    worker.onmessage = (
      event: MessageEvent<{
        progress?: ImportProgress;
        route?: RouteData;
        error?: string;
      }>,
    ) => {
      const data = event.data;
      if (data.progress) progress(data.progress);
      else if (data.error) {
        worker.terminate();
        reject(Error(data.error));
      } else if (data.route) {
        worker.terminate();
        resolve(data.route);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      // Browsers with restricted Worker loading still support the same import logic.
      void importFile(file, progress).then(resolve, reject);
    };
    worker.postMessage(file);
  });
}
