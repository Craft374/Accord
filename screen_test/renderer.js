const video = document.getElementById('screen');

const params = new URLSearchParams(location.search);
const width = Number(params.get('w'));
const height = Number(params.get('h'));

async function start() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 60, max: 60 }
    }
  });

  video.srcObject = stream;
  await video.play();

  console.log(stream.getVideoTracks()[0].getSettings());
}

start().catch(console.error);