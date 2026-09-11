/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PUBLIC_ORIGIN?: string;
  readonly VITE_BUY_ME_A_COFFEE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
