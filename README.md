Vibe Disk Game

Open `index.html` in a browser to run the demo.

Controls:
- Click the disk to stop and begin dragging.
- Move the mouse (or touch) to position the disk while held.
- Release to set the disk's velocity based on your final motion.

Notes:
- The demo uses a simple friction model and wall bounces.
- To iterate: edit `script.js` and refresh the page.

Control panel:
- Use the floating control panel (top-right) to change **Disk size** and **Friction** in real time.
- Settings persist to `localStorage` so your preferred values are remembered.

Run a simple static server from PowerShell:
```powershell
python -m http.server 8000
```
Then open http://localhost:8000 in your browser.
