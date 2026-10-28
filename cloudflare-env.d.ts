declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    GOOGLE_MAPS_API_KEY?: string;
    MAPS_SETUP_TOKEN?: string;
    MAPS_SETUP_EXPIRES_AT?: string;
    SHARED_ROUTE_EDIT_KEY?: string;
    SHARED_ROUTE_PUBLIC_EDIT?: string;
    BUCKET?: R2Bucket;
  }
}
