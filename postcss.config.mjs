// Tailwind CSS v4 through PostCSS — the setup Next.js documents (docs: getting-started/css).
// Works with both bundlers: the production build uses webpack (`next build --webpack`), and
// `next dev` (Turbopack) reads this same file, so there is one CSS pipeline everywhere.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
