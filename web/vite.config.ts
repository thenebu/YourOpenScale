import { defineConfig } from "vite";

const dir = import.meta.dirname;

export default defineConfig({
  root: dir,
  base: "/assets/",
  publicDir: false, // web/public (icons, manifest) is served by server/ts/pwa.ts
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
        sw: `${dir}/src/sw/sw.ts`, // fixed name: served as /sw.js by server/ts/pwa.ts
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "[name]-[hash].js"),
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
