/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin/prefix in production, e.g. `/finbiz-api`. Empty in local dev (Vite proxy). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
