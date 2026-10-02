import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";


// #55: the access token string changes on every silent refresh (#53), so a
// data loader keyed on it refetches -- and resets pagination -- each time.
// Key effects/callbacks/useAsyncResource deps on `sessionKey` (changes only
// on login, logout, org switch or an explicit token adoption) and read the
// current token at call time via useTokenRef(). auth.tsx owns the token
// lifecycle itself (refresh timer, switchOrg) and is exempt.
const TOKEN_DEPS_SELECTORS = [
  {
    selector:
      "CallExpression[callee.name=/^use(Effect|LayoutEffect|Callback|Memo)$/] > ArrayExpression > :matches(Identifier[name='token'], MemberExpression[property.name='token'])",
    message:
      "Don't put the access token in a hook dependency array: it changes on every silent refresh (#55). Depend on `sessionKey` from useAuth() and read the token via useTokenRef().",
  },
  {
    selector:
      "Property[key.name='deps'] > ArrayExpression > :matches(Identifier[name='token'], MemberExpression[property.name='token'])",
    message:
      "Don't put the access token in useAsyncResource deps: it changes on every silent refresh (#55). Depend on `sessionKey` from useAuth() instead.",
  },
];

// The tier vocabulary lives in ONE module
// (src/lib/billing.ts, mirroring the backend's shared/models/tiers.py);
// authorization should follow capabilities the API returns, not plan names
// sprinkled through the UI. "free" is deliberately not matched: it is also a
// plugin pricing_model value.
const TIER_LITERAL_SELECTOR = {
  selector: "Literal[value=/^(community|pro|professional|enterprise)$/]",
  message:
    "Tier names belong in src/lib/billing.ts only: import a constant from there instead of a tier string literal.",
};
const TIER_LITERAL_EXEMPT = [
  "src/lib/billing.ts",
  "src/**/*.test.{ts,tsx}",
  "src/test/**",
];

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // #55 (token deps) + #2069 (tier literals). One `no-restricted-syntax`
    // per file -- flat config REPLACES a rule's options per matching block, it
    // doesn't merge them -- so the selector sets are combined per file group.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/auth.tsx", ...TIER_LITERAL_EXEMPT],
    rules: {
      "no-restricted-syntax": ["error", ...TOKEN_DEPS_SELECTORS, TIER_LITERAL_SELECTOR],
    },
  },
  {
    files: TIER_LITERAL_EXEMPT,
    rules: { "no-restricted-syntax": ["error", ...TOKEN_DEPS_SELECTORS] },
  },
  {
    files: ["src/lib/auth.tsx"],
    rules: { "no-restricted-syntax": ["error", TIER_LITERAL_SELECTOR] },
  },
);
