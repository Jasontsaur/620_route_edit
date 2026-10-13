declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    GOOGLE_MAPS_API_KEY?: string;
    MAPS_SETUP_TOKEN?: string;
    MAPS_SETUP_EXPIRES_AT?: string;
    BUCKET?: R2Bucket;
  }
}
