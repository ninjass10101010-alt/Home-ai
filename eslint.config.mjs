import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    // `.next/**` is build output and `.worktrees/**` holds sibling git worktrees
    // (each with their own `.next`). Without these ignores, `npm run lint`
    // lints compiled vendor bundles and reports hundreds of phantom findings
    // that bury the real ones — it made the gate unusable.
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      ".worktrees/**",
      "**/.worktrees/**",
      "backups/**",
    ],
  },
];

export default eslintConfig;
