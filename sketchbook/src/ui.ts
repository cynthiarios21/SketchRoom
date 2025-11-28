import * as THREE from 'three';
import { DrawingSystem } from './drawing';

export class UIManager {
    private scene: THREE.Scene;
    private drawingSystem: DrawingSystem;
    private menuGroup: THREE.Group;
    private isVisible: boolean;
    private activeBtn: THREE.Object3D | null = null;
    public isHovering: boolean = false;

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
        undoBtn.position.set(-0.05, -0.05, 0.01);
        undoBtn.userData = { type: 'action', value: 'undo' };
        this.menuGroup.add(undoBtn);

        // Mute Button
        // Mute Button
        const muteGeo = new THREE.PlaneGeometry(0.08, 0.04);
        const muteMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green = Sound On
        const muteBtn = new THREE.Mesh(muteGeo, muteMat);
        muteBtn.position.set(0.05, -0.05, 0.01);
        muteBtn.userData = { type: 'action', value: 'mute' };
        this.menuGroup.add(muteBtn);

        // Brush Size Buttons (Small, Medium, Large)
        const sizes = [0.005, 0.01, 0.02];
        const sizeLabels = ['S', 'M', 'L'];

        sizes.forEach((size, i) => {
            const sizeGeo = new THREE.CircleGeometry(0.01 + (i * 0.005), 32); // Visual size difference
            const sizeMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
            const sizeBtn = new THREE.Mesh(sizeGeo, sizeMat);
            // Position below the color row, above undo/mute
            sizeBtn.position.set(-0.05 + (i * 0.05), 0, 0.01);
            sizeBtn.userData = { type: 'size', value: size, index: i };
            this.menuGroup.add(sizeBtn);
        });
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

    public checkIntersection(indexTipPosition: THREE.Vector3): boolean {
        if (!this.isVisible) {
            this.isHovering = false;
            return false;
        }

        let hoveredBtn: THREE.Object3D | null = null;

        // Simple distance check for buttons
        this.menuGroup.children.forEach(child => {
            if (child.userData.type) {
                const worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);
                if (worldPos.distanceTo(indexTipPosition) < 0.03) {
                    hoveredBtn = child;
                }
            }
        });

        if (hoveredBtn) {
            this.isHovering = true;
            // Only trigger if entering a new button (or re-entering after leaving)
            if (this.activeBtn !== hoveredBtn) {
                this.activeBtn = hoveredBtn;
                this.handleInteraction(hoveredBtn.userData, hoveredBtn);
            }
        } else {
            this.isHovering = false;
            this.activeBtn = null;
        }

        return this.isHovering;
    }

    public checkMouseIntersection(raycaster: THREE.Raycaster): boolean {
        if (!this.isVisible) return false;

        const intersects = raycaster.intersectObjects(this.menuGroup.children, true);
        if (intersects.length > 0) {
            const hit = intersects[0];
            if (hit.object.userData.type) {
                this.handleInteraction(hit.object.userData, hit.object);
                return true;
            }
        }
        return false;
    }

    private handleInteraction(data: any, object?: THREE.Object3D): void {
        if (data.type === 'color') {
            this.drawingSystem.setColor(data.value);
        } else if (data.type === 'action') {
            if (data.value === 'undo') {
                this.drawingSystem.undo();
            } else if (data.value === 'mute') {
                const isMuted = this.drawingSystem.toggleAudio();
                // Update button color
                if (object && object instanceof THREE.Mesh) {
                    (object.material as THREE.MeshBasicMaterial).color.setHex(isMuted ? 0xff0000 : 0x00ff00);
                }
            }
        } else if (data.type === 'size') {
            this.drawingSystem.setSize(data.value);
            // Update visual feedback for size buttons
            this.menuGroup.children.forEach(child => {
                if (child.userData.type === 'size') {
                    const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
                    if (child.userData.value === data.value) {
                        mat.color.setHex(0xffffff); // Highlight active
                    } else {
                        mat.color.setHex(0xaaaaaa); // Dim inactive
                    }
                }
            });
        }
    }
}
