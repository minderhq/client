import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    // #55: the access token string changes on every silent refresh (#53), so a
    // data loader keyed on it refetches -- and resets pagination -- each time.
    // Key effects/callbacks/useAsyncResource deps on `sessionKey` (changes only
    // on login, logout, org switch or an explicit token adoption) and read the
    // current token at call time via useTokenRef(). auth.tsx owns the token
    // lifecycle itself (refresh timer, switchOrg) and is exempt.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/auth.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
);
