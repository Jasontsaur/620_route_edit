import { type RouteData, validateRoute } from "./route";
import type { SaveAction } from "./shared-store";
export class CloudSaveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export type SharedLoad = {
  route: RouteData | null;
  revision: string | null;
  updated: string | null;
  versionId: string | null;
  csrf: string;
  canEdit: boolean;
  publicEdit: boolean;
};
type Ack = { revision: string; updated: string; versionId: string | null };
type Pending = {
  route: RouteData;
  action: SaveAction;
  note: string;
  body: string;
};
export class SharedRouteClient {
  revision: string | null = null;
  csrf = "";
  pending: Pending | null = null;
  private flight: Promise<Ack> | null = null;
  constructor(
    // Native Window.fetch must receive the browser global as its receiver.
    private fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
  ) {}
  async load(token?: string): Promise<SharedLoad> {
    if (token) {
      const r = await this.fetcher("/api/shared-route/access", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok)
        throw new CloudSaveError(d.error || "無法啟用編輯。", r.status);
    }
    const r = await this.fetcher("/api/shared-route", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const d = (await r.json()) as SharedLoad & { error?: string };
    if (!r.ok)
      throw new CloudSaveError(d.error || "共用路線讀取失敗。", r.status);
    const data = d as SharedLoad;
    if (
      typeof data.csrf !== "string" ||
      typeof data.canEdit !== "boolean" ||
      !(data.revision === null || typeof data.revision === "string")
    )
      throw Error("共用路線資料格式錯誤。");
    data.route = data.route === null ? null : validateRoute(data.route);
    this.revision = data.revision;
    this.csrf = data.csrf;
    this.pending = null;
    return data;
  }
  async save(route: RouteData, action: SaveAction, note = ""): Promise<Ack> {
    if (this.flight) throw Error("正在儲存，請稍候。");
    // Retry the exact unacknowledged operation before sending newer edits.
    const p = this.pending ?? {
      route,
      action,
      note,
      body: JSON.stringify({
        route,
        action,
        note,
        revision: this.revision,
        operationId: crypto.randomUUID(),
      }),
    };
    this.pending = p;
    this.flight = (async () => {
      const r = await this.fetcher("/api/shared-route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Route-CSRF": this.csrf,
        },
        body: p.body,
        signal: AbortSignal.timeout(30000),
      });
      const d = (await r.json()) as Ack & { error?: string };
      if (!r.ok)
        throw new CloudSaveError(d.error || "自動儲存失敗。", r.status);
      if (typeof d.revision !== "string" || typeof d.updated !== "string")
        throw Error("儲存回應不完整，請重試。");
      this.revision = d.revision;
      this.pending = null;
      return d as Ack;
    })();
    try {
      return await this.flight;
    } finally {
      this.flight = null;
    }
  }
  async editingLink() {
    const r = await this.fetcher("/api/shared-route/access", {
      headers: { "X-Route-CSRF": this.csrf },
      cache: "no-store",
    });
    const d = (await r.json()) as { token?: string; error?: string };
    if (!r.ok) throw Error(d.error || "無法取得編輯連結。");
    return location.origin + location.pathname + "#route-edit=" + d.token;
  }
}
