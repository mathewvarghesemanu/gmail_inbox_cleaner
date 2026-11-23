import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "https://mail.google.com/mail/u/0/" }
    },
    include: ["tests/**/*.test.js"]
  }
});
