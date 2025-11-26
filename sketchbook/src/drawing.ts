import * as THREE from 'three';

export interface Stroke {
    points: THREE.Vector3[];
    color: number;
    size: number;
    mesh: THREE.Mesh | null;
}

export interface StrokeData {
    points: { x: number, y: number, z: number }[];
    color: number;
    size: number;
}

export class DrawingSystem {
    private scene: THREE.Scene;
    private strokes: Stroke[];
    private currentStroke: Stroke | null;
    private brushColor: number;
    private brushSize: number;
    private material: THREE.MeshStandardMaterial;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.strokes = [];
        this.currentStroke = null;
        this.brushColor = 0x000000;
        this.brushSize = 0.01;
        this.material = new THREE.MeshStandardMaterial({
            color: this.brushColor,
            roughness: 0.5,
            metalness: 0.1
        });
    }

    public startStroke(position: THREE.Vector3, color: number = this.brushColor, size: number = this.brushSize): void {
        this.currentStroke = {
            points: [position.clone()],
            color: color,
            size: size,
            mesh: null
        };
    }

    public updateStroke(position: THREE.Vector3): void {
        if (!this.currentStroke) return;

        const points = this.currentStroke.points;
        const lastPoint = points[points.length - 1];

        // Only add point if moved enough
        if (position.distanceTo(lastPoint) > 0.005) {
            points.push(position.clone());
            this.updateStrokeMesh();
        }
    }

    public endStroke(): StrokeData | null {
        if (this.currentStroke) {
            this.strokes.push(this.currentStroke);

            // Export data for networking
            const strokeData: StrokeData = {
                points: this.currentStroke.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
                color: this.currentStroke.color,
                size: this.currentStroke.size
            };

            this.currentStroke = null;
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

    private updateStrokeMesh(): void {
        if (!this.currentStroke || this.currentStroke.points.length < 2) return;

        const path = new THREE.CatmullRomCurve3(this.currentStroke.points);
        // TubeGeometry can be expensive, for production consider MeshLine or custom shader
        const geometry = new THREE.TubeGeometry(path, this.currentStroke.points.length, this.currentStroke.size, 8, false);

        if (this.currentStroke.mesh) {
            this.currentStroke.mesh.geometry.dispose();
            this.currentStroke.mesh.geometry = geometry;
        } else {
            this.currentStroke.mesh = new THREE.Mesh(geometry, this.material.clone());
            if (this.currentStroke.mesh.material instanceof THREE.MeshStandardMaterial) {
                this.currentStroke.mesh.material.color.setHex(this.currentStroke.color);
            }
            this.scene.add(this.currentStroke.mesh);
        }
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
                stroke.mesh.geometry.dispose();
                if (Array.isArray(stroke.mesh.material)) {
                    stroke.mesh.material.forEach(m => m.dispose());
                } else {
                    stroke.mesh.material.dispose();
                }
            }
        }
    }
}
