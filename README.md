# VOID//SEND

A hybrid file-transfer MVP. The browser uses WebRTC data channels for direct transfers when possible and a Socket.IO relay fallback. The Node service also serves the built React website, so deployment needs only one public service and one URL.

## Requirements
- Node.js 20+ and npm

## Run locally on Arch Linux
```bash
sudo pacman -S nodejs npm git
npm install
npm run dev
```
Open http://localhost:5173. For local testing, the Vite frontend connects to the backend on port 3001.

## Build and run as one service
```bash
npm install
npm run build
npm start
```
Open http://localhost:3001. In production, the frontend automatically connects to the same origin for Socket.IO.

## Deploy on Render
1. Push this repository to GitHub.
2. In Render, choose New > Blueprint and select the repository containing `render.yaml`, or create a Web Service with build command `npm install && npm run build` and start command `npm start`.
3. Render will provide one public HTTPS URL for the website and Socket.IO server.

## MVP limits and caveats
- Current UI caps individual files at 100 MB. The receiver currently assembles chunks in browser memory; this is not yet suitable for multi-GB production transfers.
- Room codes are temporary and stored in server memory. Restarting or sleeping the service can end active rooms. There are no persistent cloud-download links yet.
- WebRTC direct connections use a public STUN server. Some restrictive networks require a TURN server; the relay fallback is available when the receiver is connected, but should be hardened and load-tested before public use.
- The relay is not end-to-end direct. Production needs HTTPS/WSS, TURN, authentication/authorization, rate limits, transfer quotas, abuse controls, and resumable streaming.
