import * as THREE from 'three';
import { DrawingSystem } from './drawing';

export class UIManager {
    private scene: THREE.Scene;
    private drawingSystem: DrawingSystem;
    private menuGroup: THREE.Group;
    private isVisible: boolean;

    constructor(scene: THREE.Scene, drawingSystem: DrawingSystem) {
        this.scene = scene;
        this.drawingSystem = drawingSystem;
        this.menuGroup = new THREE.Group();
        this.isVisible = false;

        this.initMenu();
        this.scene.add(this.menuGroup);
        this.menuGroup.visible = false;
    }

    private initMenu(): void {
        // Background
        const bgGeo = new THREE.PlaneGeometry(0.3, 0.2);
        const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const bg = new THREE.Mesh(bgGeo, bgMat);
        this.menuGroup.add(bg);

        // Colors
        const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xffffff];
        colors.forEach((color, i) => {
            const btnGeo = new THREE.CircleGeometry(0.02, 32);
            const btnMat = new THREE.MeshBasicMaterial({ color: color });
            const btn = new THREE.Mesh(btnGeo, btnMat);
            btn.position.set(-0.1 + (i * 0.05), 0.05, 0.01);
            btn.userData = { type: 'color', value: color };
            this.menuGroup.add(btn);
        });

        // Undo Button
        const undoGeo = new THREE.PlaneGeometry(0.08, 0.04);
        const undoMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
        const undoBtn = new THREE.Mesh(undoGeo, undoMat);
        undoBtn.position.set(0, -0.05, 0.01);
        undoBtn.userData = { type: 'action', value: 'undo' };
        this.menuGroup.add(undoBtn);
    }

    public show(position: THREE.Vector3, rotation: THREE.Quaternion): void {
        this.menuGroup.position.copy(position);
        this.menuGroup.quaternion.copy(rotation);
        // Offset slightly above palm
        this.menuGroup.translateY(0.15);
        this.menuGroup.lookAt(this.scene.position);
        this.menuGroup.visible = true;
        this.isVisible = true;
    }

    public hide(): void {
        this.menuGroup.visible = false;
        this.isVisible = false;
    }

    public checkIntersection(indexTipPosition: THREE.Vector3): void {
        if (!this.isVisible) return;

        // Simple distance check for buttons
        this.menuGroup.children.forEach(child => {
            if (child.userData.type) {
                const worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);
                if (worldPos.distanceTo(indexTipPosition) < 0.03) {
                    this.handleInteraction(child.userData);
                }
            }
        });
    }

    private handleInteraction(data: any): void {
        if (data.type === 'color') {
            this.drawingSystem.setColor(data.value);
        } else if (data.type === 'action' && data.value === 'undo') {
            this.drawingSystem.undo();
        }
    }
}
