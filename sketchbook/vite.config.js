import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true, // Listen on all addresses, including LAN
        port: 3000,
        https: false // WebXR requires HTTPS usually, but for local dev with port forwarding or localhost it might be fine. 
        // Ideally we'd use basicSsl() plugin but keeping it simple.
        // Note: WebXR requires a secure context (HTTPS or localhost). 
        // For LAN testing, you need HTTPS.
    }
});
