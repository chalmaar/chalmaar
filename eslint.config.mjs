// Minimal Next.js ESLint config — no shadcn / Tailwind rules.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // We use plain <a> and <img> tags — no next/link or next/image needed
    // for this simple booking site.
    "@next/next/no-html-link-for-pages": "off",
    "@next/next/no-img-element": "off",
    // Unused vars are fine in this small codebase
    "@typescript-eslint/no-unused-vars": "off",
    "no-unused-vars": "off",
  },
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "work/**",
    "download/**",
    "upload/**",
    "scripts/**",
  ],
}];

export default eslintConfig;
