// Global variables
let video = document.getElementById('videoFeed');
let canvasOutput = document.getElementById('canvasOutput');
let canvasContext = canvasOutput.getContext('2d');
let stream = null;
let isDetectionRunning = false;
let detectionInterval = null;

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const alertMessage = document.getElementById('alertMessage');

// OpenCV variables
let src = null;
let gray = null;
let cap = null;

// Eye closure detection variables
let eyeClosedStartTime = null;
let eyeClosedThreshold = 500; // Reduced from 1000 to 500ms for more sensitivity
let consecutiveEyeClosedFrames = 0; // Track consecutive frames with eyes closed
let frameCounterThreshold = 2; // Reduced from 3 to 2 for more sensitivity

// Initialize when OpenCV is ready

// Initialize when OpenCV is ready
function onOpenCvReady() {
    console.log('OpenCV.js is ready');
    statusDiv.textContent = 'OpenCV Loaded - Ready to Start';
    statusDiv.className = 'status normal';
    
    // Set up event listeners
    startBtn.addEventListener('click', startDetection);
    stopBtn.addEventListener('click', stopDetection);
}

// Start the detection process
async function startDetection() {
    console.log('Starting detection...');
    
    try {
        // Get camera access
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        
        // Wait for video to be loaded
        video.addEventListener('loadeddata', () => {
            // Set canvas dimensions to match video
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
        });
        
        // Enable/disable buttons
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Update status
        statusDiv.textContent = 'Camera Active - Detecting...';
        statusDiv.className = 'status normal';
        alertMessage.textContent = '';
        
        // Initialize OpenCV matrices
        src = new cv.Mat(video.height, video.width, cv.CV_8UC4);
        gray = new cv.Mat(video.height, video.width, cv.CV_8UC1);
        
        // Start detection loop
        isDetectionRunning = true;
        setTimeout(detectionLoop, 100);
        
    } catch (err) {
        console.error('Error accessing camera:', err);
        statusDiv.textContent = 'Camera Error: ' + err.message;
        statusDiv.className = 'status alert';
    }
}

// Stop the detection process
function stopDetection() {
    console.log('Stopping detection...');
    
    // Stop detection loop
    isDetectionRunning = false;
    if (detectionInterval) {
        clearTimeout(detectionInterval);
    }
    
    // Stop camera stream
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    
    // Clear canvas
    canvasContext.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
    
    // Release OpenCV matrices
    if (src) src.delete();
    if (gray) gray.delete();
    
    // Enable/disable buttons
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    // Update status
    statusDiv.textContent = 'Detection Stopped';
    statusDiv.className = 'status normal';
    alertMessage.textContent = '';
}

// Main detection loop
function detectionLoop() {
    if (!isDetectionRunning) return;
    
    try {
        // Process frame if video is ready
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            // Set canvas dimensions to match video
            canvasOutput.width = video.videoWidth;
            canvasOutput.height = video.videoHeight;
            
            // Draw video frame to canvas
            canvasContext.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
            
            // Convert canvas to OpenCV matrix
            let imageData = canvasContext.getImageData(0, 0, canvasOutput.width, canvasOutput.height);
            src = cv.matFromImageData(imageData);
            
            // Convert to grayscale
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            
            // Simple eye detection using contour analysis
            detectEyes();
            
            // Clean up
            src.delete();
        }
    } catch (err) {
        console.error('Detection error:', err);
    }
    
    // Continue loop
    if (isDetectionRunning) {
        detectionInterval = setTimeout(detectionLoop, 50); // Increased frequency from 100ms to 50ms for more sensitivity
    }
}

// Simple eye detection function
function detectEyes() {
    // Create a copy for processing
    let grayCopy = gray.clone();
    
    // Apply Gaussian blur to reduce noise
    cv.GaussianBlur(grayCopy, grayCopy, new cv.Size(7, 7), 0, 0, cv.BORDER_DEFAULT);
    
    // Apply histogram equalization
    cv.equalizeHist(grayCopy, grayCopy);
    
    // Apply threshold to get binary image
    let thresh = new cv.Mat();
    cv.threshold(grayCopy, thresh, 30, 255, cv.THRESH_BINARY_INV); // Lowered threshold from 50 to 30 for more sensitivity
    
    // Find contours
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    // Count potential eye regions
    let eyeRegions = 0;
    
    // Analyze contours to identify potential eye regions
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        // Filter by area to identify potential eyes
        if (area > 30 && area < 2500) { // Further reduced minimum area from 50 to 30 and increased max area from 2000 to 2500 for more sensitivity
            let rect = cv.boundingRect(contour);
            
            // Check if the region is in the upper portion of the frame (where eyes would be)
            if (rect.y < canvasOutput.height / 2.5) { // Increased detection area from /2 to /2.5 for more sensitivity
                // Check aspect ratio (eyes are typically wider than tall)
                let aspectRatio = rect.width / rect.height;
                if (aspectRatio > 1.0 && aspectRatio < 5.0) { // Expanded range from 1.2-4.0 to 1.0-5.0 for more sensitivity
                    eyeRegions++;
                    
                    // Draw rectangle around potential eye
                    cv.rectangle(
                        src,
                        new cv.Point(rect.x, rect.y),
                        new cv.Point(rect.x + rect.width, rect.y + rect.height),
                        [0, 255, 0, 255],
                        2
                    );
                }
            }
        }
        
        contour.delete();
    }
    
    // Determine if eyes are open or closed
    let eyesClosed = eyeRegions < 1; // Changed from < 2 to < 1 for more sensitivity (detecting even one eye closure)
    
    // Track consecutive frames with eyes closed
    if (eyesClosed) {
        consecutiveEyeClosedFrames++;
    } else {
        consecutiveEyeClosedFrames = 0; // Reset counter when eyes are open
    }
    
    // Trigger alert if eyes are closed for enough consecutive frames OR time threshold is met
    let shouldTriggerAlert = (consecutiveEyeClosedFrames >= frameCounterThreshold) || 
                            (eyeClosedStartTime && (Date.now() - eyeClosedStartTime > eyeClosedThreshold));
    
    // Handle eye closure detection
    if (eyesClosed) {
        if (!eyeClosedStartTime) {
            eyeClosedStartTime = Date.now();
        } else if (shouldTriggerAlert) {
            // Eyes have been closed for longer than threshold or enough consecutive frames
            triggerAlert();
        }
    } else {
        // Eyes are open, reset timer
        eyeClosedStartTime = null;
        clearAlert();
    }
    
    // Display result
    cv.imshow(canvasOutput, src);
    
    // Clean up
    grayCopy.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
}

// Trigger alert when eyes are closed for too long
function triggerAlert() {
    statusDiv.textContent = 'DROWSINESS DETECTED!';
    statusDiv.className = 'status alert';
    alertMessage.innerHTML = '<strong>ALERT:</strong> Driver appears drowsy! Please take a break.';
    alertMessage.style.color = 'red';
    
    // Add visual blinking effect for more noticeable alert
    alertMessage.classList.add('alert');
    
    // Play audio alert
    const alertSound = document.getElementById('alertSound');
    if (alertSound) {
        alertSound.currentTime = 0;
        alertSound.play().catch(e => console.log("Audio play failed:", e));
    }
    
    // Play alert sound (if implemented)
    console.log('DROWSINESS ALERT TRIGGERED!');
}

// Clear alert when eyes reopen
function clearAlert() {
    statusDiv.textContent = 'Monitoring - Eyes Detected';
    statusDiv.className = 'status normal';
    alertMessage.textContent = 'Driver is alert';
    alertMessage.style.color = 'green';
    
    // Remove blinking effect
    alertMessage.classList.remove('alert');
}