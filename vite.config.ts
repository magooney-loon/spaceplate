import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { threlteStudio } from "@threlte/studio/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    threlteStudio(),
    svelte(),
    visualizer({
      filename: "stats.html",
      open: false,
      gzipSize: true,
    }),
  ],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
});
