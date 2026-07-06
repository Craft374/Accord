const { app, BrowserWindow, desktopCapturer, session, screen } = require('electron');
const path = require('node:path');

let targetDisplay;

app.whenReady().then(() => {
  targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const { x, y, width, height } = targetDisplay.bounds;
  const scale = targetDisplay.scaleFactor;

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    });

    const source =
      sources.find(s => s.display_id === String(targetDisplay.id)) ?? sources[0];

    callback({ video: source });
  });

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false
    }
  });

  const captureWidth = Math.round(width * scale);
  const captureHeight = Math.round(height * scale);

  win.loadFile('index.html', {
    query: {
      w: String(captureWidth),
      h: String(captureHeight)
    }
  });
});