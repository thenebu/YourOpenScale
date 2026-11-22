import { defineConfig } from "vite";

const dir = import.meta.dirname;

export default defineConfig({
  root: dir,
  base: "/assets/",
  build: {
    outDir: "dist",
    assetsDir: ".",
    manifest: true,
    emptyOutDir: true,
    target: "es2022",
    cssMinify: "lightningcss",
    rollupOptions: {
      input: {
        app: `${dir}/src/entries/app.ts`,
        charts: `${dir}/src/entries/charts.ts`,
      },
    },
  },
  css: { transformer: "lightningcss" },
  resolve: { alias: { "@analysis": `${dir}/../server/ts/analysis` } },
  server: {
    proxy: {
      // everything except /assets and /@vite goes to the app server
      "^/(?!assets(/|$)|@)": "http://127.0.0.1:8099",
    },
  },
});
