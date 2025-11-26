# Collaborative 3D Sketchbook

A production-ready, real-time, multi-user 3D creation application built for the Meta Horizon Start Developer Competition using the Immersive Web SDK (IWSDK) / WebXR.

## Features

*   **Hand Interactions**: Draw in 3D space using pinch gestures. No controllers required.
*   **Spatial UI**: Intuitive palm-up menu for color and tool selection.
*   **Social Collaboration**: Real-time networking allowing multiple users to create together.
*   **Performance Optimized**: Built with Three.js and optimized for Meta Quest devices.

## Setup & Deployment

1.  **Prerequisites**: Node.js v20.19.0+
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Run Locally**:
    ```bash
    npm run dev
    ```
    Open the provided URL in your Meta Quest browser (ensure you are on the same network or use a tunnel like ngrok).
4.  **Build for Production**:
    ```bash
    npm run build
    ```
5.  **Deploy**:
    Upload the `dist` folder to any static host (GitHub Pages, Vercel, Netlify).

## Controls

*   **Draw**: Pinch index finger and thumb on your dominant hand.
*   **Menu**: Hold your non-dominant hand palm up to reveal the menu.
*   **Select**: Poke menu buttons with your dominant index finger.
