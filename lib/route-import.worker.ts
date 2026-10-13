import { importFile } from "./files";
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const route = await importFile(event.data, (progress) =>
      self.postMessage({ progress }),
    );
    self.postMessage({ route });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "匯入失敗",
    });
  }
};
