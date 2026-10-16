import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), {
      name: 'development-react-refresh-csp',
      transformIndexHtml(html, context) {
        // React Refresh injects an inline preamble only in development.
        return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
      }
    }]
  }
});
