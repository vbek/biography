/* AR Survival — camera access and the page side of the two tracking workers. */
window.ARTracker = (() => {
  'use strict';
  const video = document.getElementById('cam');
  let stream = null, wanted = false, started = false;
  // detection input sizes: faces are found fine at low resolution, hands need more detail at arm's length
  const lanes = {
    face: { worker: null, ready: false, inFlight: false, lastTime: -1, notBefore: 0, size: 320 },
    hand: { worker: null, ready: false, inFlight: false, lastTime: -1, notBefore: 0, size: 480 },
  };

  const api = {
    video,
    cameraOn: false, faceReady: false, handReady: false, aiFailed: false,
    faceMs: 0, handMs: 0, delegate: '',
    onProgress: null, onResult: null, onStatus: null,
    get videoW() { return video.videoWidth; },
    get videoH() { return video.videoHeight; },
  };

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('unsupported');
      e.name = window.isSecureContext ? 'NotSupportedError' : 'InsecureContext';
      throw e;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    });
    video.srcObject = stream;
    await video.play();
    api.cameraOn = true;
    wanted = true;
  }

  function closeCamera() {
    wanted = false;
    api.cameraOn = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function fail(role, message) {
    api.aiFailed = true;
    api.failedRole = role;
    api.error = message;
    api.onStatus?.();
  }

  function startLane(role) {
    const lane = lanes[role];
    lane.worker = new Worker('vision-worker.js');
    lane.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') api.onProgress?.(m);
      else if (m.type === 'ready') {
        lane.ready = true;
        api[role + 'Ready'] = true;
        if (role === 'face') startLane('hand');
        else api.delegate = m.delegate;
        api.onStatus?.();
      } else if (m.type === 'error') fail(role, m.message);
      else if (m.type === 'result') {
        lane.inFlight = false;
        // a struggling hand model rests between frames so it cannot take the CPU away from face tracking
        if (role === 'hand' && m.ms > 40) lane.notBefore = performance.now() + m.ms * 0.3;
        api[role + 'Ms'] = api[role + 'Ms'] * 0.9 + m.ms * 0.1;
        if (m.error) api.lastFrameError = m.error;
        else api.onResult?.(m);
      }
    };
    lane.worker.onerror = (e) => fail(role, e.message || 'AI worker failed');
    lane.worker.postMessage({ type: 'init', role });
  }

  function startAI() {
    if (api.aiFailed) {
      api.aiFailed = false;
      lanes[api.failedRole].worker?.terminate();
      startLane(api.failedRole);
      return;
    }
    if (started) return;
    started = true;
    startLane('face');
  }

  /* Called once per animation frame: each model gets the newest camera frame as soon as it is free. */
  function pump() {
    if (!api.cameraOn || document.hidden || video.readyState < 2 || !video.videoWidth) return;
    for (const role of ['face', 'hand']) {
      const lane = lanes[role];
      if (!lane.ready || lane.inFlight || video.currentTime === lane.lastTime || performance.now() < lane.notBefore) continue;
      lane.lastTime = video.currentTime;
      lane.inFlight = true;
      const vw = video.videoWidth, vh = video.videoHeight, scale = Math.min(1, lane.size / Math.max(vw, vh));
      createImageBitmap(video, { resizeWidth: Math.round(vw * scale), resizeHeight: Math.round(vh * scale), resizeQuality: 'low' })
        .catch(() => createImageBitmap(video))
        .then((bitmap) => lane.worker.postMessage({ type: 'frame', bitmap }, [bitmap]))
        .catch(() => { lane.inFlight = false; });
    }
  }

  // mobile browsers can end the camera while the page is in the background
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !wanted) return;
    if (!stream || stream.getVideoTracks().some((t) => t.readyState === 'ended')) {
      try { await openCamera(); } catch { api.cameraOn = false; api.onStatus?.(); }
    } else video.play().catch(() => {});
  });
  window.addEventListener('pagehide', closeCamera);

  return Object.assign(api, { openCamera, closeCamera, startAI, pump });
})();
