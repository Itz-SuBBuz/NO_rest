/**
 * Sleep Detection System
 * Advanced drowsiness detection using MediaPipe FaceMesh
 * 
 * Features:
 * - Real-time eye tracking with EAR (Eye Aspect Ratio)
 * - EAR smoothing to reduce noise and false positives
 * - Blink counting
 * - Drowsiness score calculation
 * - Audio/visual alerts
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    // EAR thresholds
    EAR_THRESHOLD: 0.22,           // Below this = eyes closed
    EAR_CONSEC_FRAMES: 1,          // Just 1 frame for instant detection

    // Drowsiness detection
    DROWSINESS_TIME_MS: 0,         // Instant trigger when eyes close
    SMOOTHING_FACTOR: 0.7,         // EAR smoothing (0-1, higher = faster response)

    // MediaPipe settings
    DETECTION_CONFIDENCE: 0.5,
    TRACKING_CONFIDENCE: 0.5,

    // Camera settings
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,

    // Background processing settings
    BACKGROUND_PROCESS_INTERVAL: 100  // Process every 100ms when in background (10 FPS)
};

// Eye landmark indices for MediaPipe FaceMesh (6-point EAR formula)
const EYE_LANDMARKS = {
    // [outer corner, upper1, upper2, inner corner, lower1, lower2]
    RIGHT: [33, 160, 158, 133, 153, 144],
    LEFT: [362, 387, 385, 263, 380, 373]
};

// ============================================
// STATE
// ============================================
const state = {
    // Core
    isRunning: false,
    faceMesh: null,
    camera: null,
    stream: null,

    // Detection
    smoothedEAR: 0.3,
    consecutiveClosedFrames: 0,
    eyeClosedStartTime: null,
    blinkCount: 0,
    lastBlinkTime: 0,
    drowsinessScore: 0,

    // Audio
    isAlertPlaying: false,

    // Background processing
    backgroundInterval: null,
    isPageVisible: true
};

// ============================================
// DOM ELEMENTS
// ============================================
const DOM = {
    video: document.getElementById('videoFeed'),
    canvas: document.getElementById('canvasOutput'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    status: document.getElementById('status'),
    statusIndicator: document.getElementById('statusIndicator'),
    alertMessage: document.getElementById('alertMessage'),
    alertSound: document.getElementById('alertSound'),

    // Metrics
    earValue: document.getElementById('earValue'),
    blinkCount: document.getElementById('blinkCount'),
    drowsinessScore: document.getElementById('drowsinessScore')
};

const ctx = DOM.canvas.getContext('2d');

// ============================================
// INITIALIZATION
// ============================================
function initializeFaceMesh() {
    state.faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    state.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: CONFIG.DETECTION_CONFIDENCE,
        minTrackingConfidence: CONFIG.TRACKING_CONFIDENCE
    });

    state.faceMesh.onResults(processResults);
}

// ============================================
// CAMERA CONTROL
// ============================================
async function startDetection() {
    try {
        // Get camera
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: { width: CONFIG.CAMERA_WIDTH, height: CONFIG.CAMERA_HEIGHT }
        });
        DOM.video.srcObject = state.stream;

        // Initialize FaceMesh
        initializeFaceMesh();

        // Set up camera - we'll manage frame processing ourselves for background support
        state.camera = new Camera(DOM.video, {
            onFrame: async () => {
                // Only process via Camera when page is visible
                if (state.isPageVisible) {
                    await state.faceMesh.send({ image: DOM.video });
                }
            },
            width: CONFIG.CAMERA_WIDTH,
            height: CONFIG.CAMERA_HEIGHT
        });

        await state.camera.start();

        // Update UI
        DOM.canvas.width = CONFIG.CAMERA_WIDTH;
        DOM.canvas.height = CONFIG.CAMERA_HEIGHT;
        DOM.startBtn.disabled = true;
        DOM.stopBtn.disabled = false;

        state.isRunning = true;
        updateStatus('Monitoring Active', 'normal');

        // Unlock audio
        unlockAudio();

        // Set up visibility change listener for background processing
        setupVisibilityHandler();

        console.log('Detection started');

    } catch (err) {
        console.error('Camera error:', err);
        updateStatus('Camera Error: ' + err.message, 'alert');
    }
}

function stopDetection() {
    state.isRunning = false;

    // Clear background processing interval
    if (state.backgroundInterval) {
        clearInterval(state.backgroundInterval);
        state.backgroundInterval = null;
    }

    if (state.camera) state.camera.stop();
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());

    ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);

    // Reset UI
    DOM.startBtn.disabled = false;
    DOM.stopBtn.disabled = true;

    // Reset state
    resetState();
    updateStatus('Detection Stopped', 'normal');
    updateMetrics(0, 0, 0);
    clearAlert();

    console.log('Detection stopped');
}

function resetState() {
    state.smoothedEAR = 0.3;
    state.consecutiveClosedFrames = 0;
    state.eyeClosedStartTime = null;
    state.blinkCount = 0;
    state.drowsinessScore = 0;
    state.isAlertPlaying = false;
}

// ============================================
// FACE MESH PROCESSING
// ============================================
function processResults(results) {
    ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);

    // Draw camera feed
    ctx.drawImage(results.image, 0, 0, DOM.canvas.width, DOM.canvas.height);

    if (!results.multiFaceLandmarks?.length) {
        drawNoFace();
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    // Calculate EAR
    const leftEAR = calculateEAR(landmarks, EYE_LANDMARKS.LEFT);
    const rightEAR = calculateEAR(landmarks, EYE_LANDMARKS.RIGHT);
    const rawEAR = (leftEAR + rightEAR) / 2;

    // Apply smoothing to reduce noise
    state.smoothedEAR = smoothValue(state.smoothedEAR, rawEAR, CONFIG.SMOOTHING_FACTOR);

    // Detect eye state
    const eyesClosed = state.smoothedEAR < CONFIG.EAR_THRESHOLD;

    // Process detection
    processEyeState(eyesClosed);

    // Draw visualization
    drawVisualization(landmarks, eyesClosed);

    // Update metrics
    updateMetrics(state.smoothedEAR, state.blinkCount, state.drowsinessScore);
}

function processEyeState(eyesClosed) {
    if (eyesClosed) {
        state.consecutiveClosedFrames++;
        state.drowsinessScore = 100;

        // Trigger alert INSTANTLY when eyes are closed
        triggerAlert();

    } else {
        // Eyes are open - count blink if was briefly closed
        if (state.consecutiveClosedFrames >= CONFIG.EAR_CONSEC_FRAMES &&
            state.consecutiveClosedFrames < 15) {
            state.blinkCount++;
        }

        // Reset
        state.consecutiveClosedFrames = 0;
        state.drowsinessScore = 0;

        clearAlert();
    }
}

// ============================================
// EAR CALCULATION
// ============================================
function calculateEAR(landmarks, indices) {
    const [p1, p2, p3, p4, p5, p6] = indices.map(i => landmarks[i]);

    // Vertical distances (eyelid openness)
    const v1 = distance(p2, p6);
    const v2 = distance(p3, p5);

    // Horizontal distance (eye width)
    const h = distance(p1, p4);

    // EAR formula
    return (v1 + v2) / (2 * h);
}

function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function smoothValue(current, target, factor) {
    return current + (target - current) * factor;
}

// ============================================
// VISUALIZATION
// ============================================
function drawVisualization(landmarks, eyesClosed) {
    // Draw eye landmarks
    const eyeColor = eyesClosed ? '#ef4444' : '#4ade80';

    drawEyePoints(landmarks, EYE_LANDMARKS.LEFT, eyeColor);
    drawEyePoints(landmarks, EYE_LANDMARKS.RIGHT, eyeColor);

    // Draw status overlay
    if (eyesClosed && state.drowsinessScore > 50) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);
    }

    // Draw EAR value
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(`EAR: ${state.smoothedEAR.toFixed(3)}`, 15, 30);
    ctx.shadowBlur = 0;
}

function drawEyePoints(landmarks, indices, color) {
    ctx.fillStyle = color;
    indices.forEach(i => {
        const point = landmarks[i];
        const x = point.x * DOM.canvas.width;
        const y = point.y * DOM.canvas.height;

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
    });
}

function drawNoFace() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No face detected', DOM.canvas.width / 2, DOM.canvas.height / 2);
    ctx.textAlign = 'left';

    resetState();
    clearAlert();
}

// ============================================
// UI UPDATES
// ============================================
function updateStatus(text, type) {
    DOM.status.textContent = text;
    DOM.status.className = type;
    DOM.statusIndicator.className = 'status-indicator ' + type;
}

function updateMetrics(ear, blinks, drowsiness) {
    DOM.earValue.textContent = ear > 0 ? ear.toFixed(3) : '--';
    DOM.blinkCount.textContent = blinks;
    DOM.drowsinessScore.textContent = drowsiness + '%';

    // Color drowsiness based on level
    if (drowsiness > 70) {
        DOM.drowsinessScore.style.color = '#ef4444';
    } else if (drowsiness > 40) {
        DOM.drowsinessScore.style.color = '#fbbf24';
    } else {
        DOM.drowsinessScore.style.color = '#4ade80';
    }
}

// ============================================
// ALERTS
// ============================================
function triggerAlert() {
    updateStatus('⚠️ DROWSINESS DETECTED!', 'alert');

    DOM.alertMessage.textContent = '🚨 Wake up! You appear drowsy. Please take a break!';
    DOM.alertMessage.className = 'alert';

    // Play sound
    if (!state.isAlertPlaying && DOM.alertSound) {
        state.isAlertPlaying = true;
        DOM.alertSound.currentTime = 0;
        DOM.alertSound.play().catch(e => {
            console.log('Audio error:', e);
            state.isAlertPlaying = false;
        });
    }
}

function clearAlert() {
    if (state.isRunning) {
        updateStatus('Monitoring Active', 'normal');
    }

    DOM.alertMessage.textContent = 'Driver is alert and focused';
    DOM.alertMessage.className = 'normal';

    // Stop sound
    if (DOM.alertSound) {
        DOM.alertSound.pause();
        DOM.alertSound.currentTime = 0;
    }
    state.isAlertPlaying = false;
}

function unlockAudio() {
    if (DOM.alertSound) {
        DOM.alertSound.volume = 1.0;
        DOM.alertSound.play()
            .then(() => {
                DOM.alertSound.pause();
                DOM.alertSound.currentTime = 0;
                console.log('Audio unlocked');
            })
            .catch(e => console.log('Audio unlock:', e));
    }
}

// ============================================
// BACKGROUND PROCESSING (minimized window support)
// ============================================
function setupVisibilityHandler() {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    console.log('Visibility handler set up for background processing');
}

function handleVisibilityChange() {
    state.isPageVisible = !document.hidden;

    if (document.hidden) {
        // Page is hidden (minimized/tab switched) - start background processing
        startBackgroundProcessing();
        console.log('Switched to background processing mode');
    } else {
        // Page is visible - stop background processing (Camera will handle it)
        stopBackgroundProcessing();
        console.log('Switched to foreground processing mode');
    }
}

function startBackgroundProcessing() {
    if (state.backgroundInterval || !state.isRunning) return;

    state.backgroundInterval = setInterval(async () => {
        if (!state.isRunning || !state.faceMesh) return;

        try {
            // Process frame using video element directly
            await state.faceMesh.send({ image: DOM.video });
        } catch (err) {
            console.log('Background processing frame error:', err);
        }
    }, CONFIG.BACKGROUND_PROCESS_INTERVAL);

    console.log('Background processing started at', CONFIG.BACKGROUND_PROCESS_INTERVAL, 'ms intervals');
}

function stopBackgroundProcessing() {
    if (state.backgroundInterval) {
        clearInterval(state.backgroundInterval);
        state.backgroundInterval = null;
        console.log('Background processing stopped');
    }
}

// ============================================
// EVENT LISTENERS
// ============================================
DOM.startBtn.addEventListener('click', startDetection);
DOM.stopBtn.addEventListener('click', stopDetection);