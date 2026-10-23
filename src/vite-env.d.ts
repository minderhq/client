/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** saas | self-hosted (default) | air-gapped -- see lib/billing.ts. */
  readonly VITE_DEPLOYMENT_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
