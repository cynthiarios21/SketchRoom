import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

export interface Stroke {
    points: THREE.Vector3[];
    color: number;
    size: number;
    mesh: THREE.Mesh | Line2 | null;
}

export interface StrokeData {
    points: { x: number, y: number, z: number }[];
    color: number;
    size: number;
}

export class DrawingSystem {
    private scene: THREE.Scene;
    private strokes: Stroke[];
    private brushColor: number;
    private brushSize: number;
    private material: THREE.MeshStandardMaterial;
    private lineMaterial: LineMaterial;

    // Audio (FM Synthesis)
    private audioContext: AudioContext | null = null;
    private carrier: OscillatorNode | null = null;
    private modulator: OscillatorNode | null = null;
    private modulatorGain: GainNode | null = null;
    private mainGain: GainNode | null = null;
    private isMuted: boolean = false;

    // Multi-stroke state
    private activeStrokes: Map<string, {
        stroke: Stroke;
        lastPosition: THREE.Vector3;
        smoothedPosition: THREE.Vector3;
        lastTime: number;
    }> = new Map();

    // Undo/Redo
    private undoneStrokes: Stroke[] = [];

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.strokes = [];
        this.brushColor = 0x000000;
        this.brushSize = 0.003; // 3mm default (finer)
        this.material = new THREE.MeshStandardMaterial({
            color: this.brushColor,
            roughness: 0.5,
            metalness: 0.1
        });

        this.lineMaterial = new LineMaterial({
            color: this.brushColor,
            linewidth: 0.003, // in world units (meters)
            worldUnits: true, // Consistent size in VR
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        });

        this.initAudio();
    }

    private initAudio(): void {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.mainGain = this.audioContext.createGain();
            this.mainGain.connect(this.audioContext.destination);
            this.mainGain.gain.value = 0;
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }

    private startSound(): void {
        if (!this.audioContext || !this.mainGain || this.isMuted) return;

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // FM Synthesis Setup
        // Carrier (The main tone)
        this.carrier = this.audioContext.createOscillator();
        this.carrier.type = 'sine';

        // Modulator (The "texture" or "timbre")
        this.modulator = this.audioContext.createOscillator();
        this.modulator.type = 'sine';

        this.modulatorGain = this.audioContext.createGain();

        // Routing: Modulator -> ModulatorGain -> Carrier.frequency
        this.modulator.connect(this.modulatorGain);
        this.modulatorGain.connect(this.carrier.frequency);

        // Carrier -> MainGain -> Output
        this.carrier.connect(this.mainGain);

        // Start
        const now = this.audioContext.currentTime;
        this.carrier.start(now);
        this.modulator.start(now);

        // Initial values
        this.carrier.frequency.setValueAtTime(440, now);
        this.modulator.frequency.setValueAtTime(880, now); // 2:1 ratio for harmonic bell sound
        this.modulatorGain.gain.setValueAtTime(200, now); // Modulation index
        this.mainGain.gain.setValueAtTime(0, now);
    }

    private updateSound(speed: number): void {
        if (!this.carrier || !this.modulator || !this.modulatorGain || !this.mainGain || !this.audioContext || this.isMuted) return;
        if (!Number.isFinite(speed)) return;

        const now = this.audioContext.currentTime;

        // Volume based on speed
        const targetVolume = Math.min(speed * 0.5, 0.4);
        this.mainGain.gain.setTargetAtTime(targetVolume, now, 0.1);

        // Pitch modulation based on speed (Magical "shimmer")
        // Higher speed = Higher pitch + more modulation
        const baseFreq = 400 + (speed * 200);
        this.carrier.frequency.setTargetAtTime(baseFreq, now, 0.1);

        // Modulator ratio changes slightly for "sparkle"
        this.modulator.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.1);
        this.modulatorGain.gain.setTargetAtTime(300 + (speed * 500), now, 0.1);
    }

    private stopSound(): void {
        if (!this.mainGain || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        this.mainGain.gain.setTargetAtTime(0, now, 0.1);

        setTimeout(() => {
            if (this.carrier) {
                this.carrier.stop();
                this.carrier.disconnect();
                this.carrier = null;
            }
            if (this.modulator) {
                this.modulator.stop();
                this.modulator.disconnect();
                this.modulator = null;
            }
            if (this.modulatorGain) {
                this.modulatorGain.disconnect();
                this.modulatorGain = null;
            }
        }, 200);
    }

    public toggleAudio(): boolean {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            this.stopSound();
        }
        return this.isMuted;
    }

    public startStroke(sourceId: string, position: THREE.Vector3, color: number = this.brushColor, size: number = this.brushSize): void {
        const stroke: Stroke = {
            points: [position.clone(), position.clone()],
            color: color,
            size: size,
            mesh: null
        };

        this.activeStrokes.set(sourceId, {
            stroke: stroke,
            lastPosition: position.clone(),
            smoothedPosition: position.clone(),
            lastTime: performance.now()
        });

        this.startSound();

        // Create initial Line2
        const geometry = new LineGeometry();
        geometry.setPositions([
            position.x, position.y, position.z,
            position.x, position.y, position.z
        ]);

        const mat = this.lineMaterial.clone();
        const c = new THREE.Color(color);
        c.multiplyScalar(1.5);
        mat.color.copy(c);
        mat.linewidth = size;

        const line = new Line2(geometry, mat);
        stroke.mesh = line;
        this.scene.add(line);
    }

    public updateStroke(sourceId: string, position: THREE.Vector3): void {
        const state = this.activeStrokes.get(sourceId);
        if (!state || !state.stroke.mesh) return;

        const points = state.stroke.points;
        const lastPoint = points[points.length - 1];

        // Smooth input position (Low-Pass Filter)
        state.smoothedPosition.lerp(position, 0.4);

        // Only add point if moved enough
        const dist = state.smoothedPosition.distanceTo(lastPoint);
        if (dist > 0.01) {
            points.push(state.smoothedPosition.clone());

            // Filter duplicates
            const uniquePoints = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 0.001);

            if (uniquePoints.length < 2) return;

            // Spline Smoothing
            const curve = new THREE.CatmullRomCurve3(uniquePoints);
            const smoothPoints = curve.getPoints(uniquePoints.length * 8);

            const flatPoints = [];
            for (const p of smoothPoints) {
                flatPoints.push(p.x, p.y, p.z);
            }

            const line = state.stroke.mesh as Line2;
            line.geometry.dispose();
            line.geometry = new LineGeometry();
            line.geometry.setPositions(flatPoints);

            // Audio Feedback
            const now = performance.now();
            const dt = (now - state.lastTime) / 1000;

            if (dt > 0.001) {
                const speed = dist / dt;
                if (Number.isFinite(speed)) {
                    this.updateSound(speed);
                }
            }

            state.lastPosition.copy(position);
            state.lastTime = now;
        }
    }

    public endStroke(sourceId: string): StrokeData | null {
        const state = this.activeStrokes.get(sourceId);
        if (state) {
            this.stopSound();

            if (state.stroke.mesh) {
                this.scene.remove(state.stroke.mesh);
                (state.stroke.mesh as Line2).geometry.dispose();
            }

            // Create final mesh
            this.updateStrokeMesh(state.stroke);

            this.strokes.push(state.stroke);
            this.undoneStrokes = [];

            const strokeData: StrokeData = {
                points: state.stroke.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
                color: state.stroke.color,
                size: state.stroke.size
            };

            this.activeStrokes.delete(sourceId);
            return strokeData;
        }
        return null;
    }

    public drawRemoteStroke(data: StrokeData): void {
        const points = data.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
        if (points.length < 2) return;

        const path = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(path, points.length, data.size, 8, false);
        const material = this.material.clone();
        material.color.setHex(data.color);

        const mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);

        this.strokes.push({
            points: points,
            color: data.color,
            size: data.size,
            mesh: mesh
        });
    }

    private updateStrokeMesh(stroke: Stroke): void {
        if (stroke.points.length < 2) return;

        const path = new THREE.CatmullRomCurve3(stroke.points);
        const geometry = new THREE.TubeGeometry(path, stroke.points.length, stroke.size, 8, false);

        const mesh = new THREE.Mesh(geometry, this.material.clone());
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
            mesh.material.color.setHex(stroke.color);
        }
        this.scene.add(mesh);
        stroke.mesh = mesh;
    }

    public setColor(color: number): void {
        this.brushColor = color;
    }

    public setSize(size: number): void {
        this.brushSize = size;
    }

    public undo(): void {
        if (this.strokes.length > 0) {
            const stroke = this.strokes.pop();
            if (stroke && stroke.mesh) {
                this.scene.remove(stroke.mesh);
                // Save to undo stack for redo
                this.undoneStrokes.push(stroke);
            }
        }
    }

    public redo(): void {
        if (this.undoneStrokes.length > 0) {
            const stroke = this.undoneStrokes.pop();
            if (stroke && stroke.mesh) {
                this.scene.add(stroke.mesh);
                this.strokes.push(stroke);
            }
        }
    }

    public deleteStroke(mesh: THREE.Mesh | Line2): void {
        const index = this.strokes.findIndex(s => s.mesh === mesh);
        if (index !== -1) {
            const stroke = this.strokes[index];
            if (stroke.mesh) {
                this.scene.remove(stroke.mesh);
                stroke.mesh.geometry.dispose();
                if (Array.isArray(stroke.mesh.material)) {
                    stroke.mesh.material.forEach(m => m.dispose());
                } else {
                    stroke.mesh.material.dispose();
                }
            }
            this.strokes.splice(index, 1);
            // Clear redo stack when deleting
            this.undoneStrokes = [];
        }
    }

    public clear(): void {
        // Remove all strokes from scene
        this.strokes.forEach(stroke => {
            if (stroke.mesh) {
                this.scene.remove(stroke.mesh);
                stroke.mesh.geometry.dispose();
                if (Array.isArray(stroke.mesh.material)) {
                    stroke.mesh.material.forEach(m => m.dispose());
                } else {
                    stroke.mesh.material.dispose();
                }
            }
        });

        // Clear arrays
        this.strokes = [];
        this.undoneStrokes = [];
    }

    public getAllStrokeMeshes(): (THREE.Mesh | Line2)[] {
        return this.strokes.map(s => s.mesh).filter(m => m !== null) as (THREE.Mesh | Line2)[];
    }
}
