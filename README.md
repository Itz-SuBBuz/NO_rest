# Advanced Sleep Detection System

A real-time drowsiness detection system that uses your webcam to monitor eye closure and alerts when drowsiness is detected.

## Features

- Real-time face and eye monitoring using MediaPipe FaceMesh
- Advanced drowsiness detection based on Eye Aspect Ratio (EAR)
- Visual and audio alerts when drowsiness is detected
- Simple start/stop controls

## How It Works

1. The system accesses your webcam feed
2. It uses MediaPipe FaceMesh to detect facial landmarks with high precision
3. It calculates the Eye Aspect Ratio (EAR) for both eyes
4. If EAR falls below the threshold for a specified duration, an alert is triggered
5. The system continuously monitors and provides real-time feedback

## Requirements

- A modern web browser (Chrome, Firefox, Edge)
- A working webcam
- Internet connection (for loading MediaPipe libraries)

## Usage

1. Open `index.html` in your web browser
2. Click "Start Detection" to begin monitoring
3. Allow camera access when prompted by your browser
4. The system will start detecting eyes and monitoring for drowsiness
5. If your eyes are closed for more than 0.5 seconds, an alert will appear
6. Click "Stop Detection" to end the monitoring session

## Technical Details

The system uses:
- MediaPipe FaceMesh for precise facial landmark detection
- Eye Aspect Ratio (EAR) calculation for accurate eye closure detection
- Time-based and frame-based detection for responsive alerts

## Advantages Over Basic Version

- Uses advanced computer vision models (MediaPipe FaceMesh)
- More accurate eye detection using 16 facial landmarks per eye
- Implements proven EAR algorithm for drowsiness detection
- Better performance in various lighting conditions
- Higher precision and fewer false positives

## Customization

You can adjust the sensitivity by modifying:
- `earThreshold` in `advanced_script.js` (default: 0.25)
- `eyeClosedThreshold` in `advanced_script.js` (default: 500ms)
- `frameCounterThreshold` in `advanced_script.js` (default: 2 frames)