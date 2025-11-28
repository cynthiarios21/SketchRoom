import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { NetworkManager } from './networking';
import { DrawingSystem } from './drawing';
import { ColorPalette } from './ColorPalette';
import { Line2 } from 'three/addons/lines/Line2.js';

// Constants
const INTERACTION_DISTANCE_SHADE = 0.02;
const INTERACTION_DISTANCE_BUTTON = 0.04;
const INTERACTION_DISTANCE_SLOT = 0.025;

// Interfaces
interface XRInputEvent extends THREE.Event {
    data?: any;
    target: THREE.Group;
}

interface XRHandWithJoints extends THREE.Group {
    joints: { [key: string]: { position: THREE.Vector3 } };
}

class App {
    private container: HTMLElement;
    private camera: THREE.PerspectiveCamera;
    private scene: THREE.Scene;
    private renderer: THREE.WebGLRenderer;
    private userGroup: THREE.Group; // Rig for camera and controllers
    private hand1!: THREE.Group;
    private hand2!: THREE.Group;
    private cursor1!: THREE.Mesh;
    private cursor2!: THREE.Mesh;

    // Controllers
    private controller1!: THREE.Group;
    private controller2!: THREE.Group;
    private controllerGrip1!: THREE.Group;
    private controllerGrip2!: THREE.Group;

    private drawingSystem: DrawingSystem;
    private networkManager: NetworkManager;
    private colorPalette: ColorPalette;

    // Color Palette UI
    private paletteGroup!: THREE.Group;
    private colorSpheres: THREE.Mesh[] = [];

    // Shade Picker
    private shadePickerGroup!: THREE.Group;
    private shadeSpheres: THREE.Mesh[] = [];
    private activeShadeSlotIndex: number = -1;

    // UI Buttons
    private undoButton!: THREE.Mesh;
    private clearButton!: THREE.Mesh;

    // Eraser & Teleport
    private isEraserMode: boolean = false;
    private teleportMarker!: THREE.Mesh;
    private wasXButtonPressed: boolean = false;

    constructor() {
        this.container = document.createElement('div');
        document.body.appendChild(this.container);

        this.scene = new THREE.Scene();

        // Wider FOV 90 for 2D mode to fix "zoomed in" feeling (VR overrides this)
        this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 100);

        // Create User Rig
        this.userGroup = new THREE.Group();
        this.scene.add(this.userGroup);
        this.userGroup.add(this.camera);

        // Initial Position (User starts 4m back for better overview)
        this.userGroup.position.set(0, 0, 4);
        // Camera height for 2D mode (VR will override local position)
        this.camera.position.set(0, 1.6, 0);

        // Best Practices: High performance and high precision for VR
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            precision: 'highp',
            depth: true,
            stencil: false // Disable stencil if not needed to save performance
        });

        // Restore pixel ratio for sharp 2D view, but cap at 2 for performance
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.xr.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // Systems (must initialize before XR for color palette)
        this.drawingSystem = new DrawingSystem(this.scene);
        this.networkManager = new NetworkManager();
        this.colorPalette = new ColorPalette();
        this.scene.background = new THREE.Color(0xffffff);
        this.scene.fog = new THREE.Fog(0xffffff, 5, 30);

        const gridGroup = new THREE.Group();

        // Helper to create consistent grids
        const createGrid = (size: number, divisions: number, color: number) => {
            const grid = new THREE.GridHelper(size, divisions, color, color);
            (grid.material as THREE.Material).transparent = true;
            (grid.material as THREE.Material).opacity = 0.2;
            return grid;
        };

        const gridColor = 0xcccccc; // Light Gray
        const size = 40;
        const divisions = 40;

        // Floor (Solid)
        const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,
            metalness: 0.1
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Floor Grid
        const floorGrid = createGrid(size, divisions, gridColor);
        gridGroup.add(floorGrid);

        // Ceiling
        const ceiling = createGrid(size, divisions, gridColor);
        ceiling.position.y = 10;
        gridGroup.add(ceiling);

        // Back Wall
        const backWall = createGrid(size, divisions, gridColor);
        backWall.rotation.x = Math.PI / 2;
        backWall.position.set(0, 5, -20);
        gridGroup.add(backWall);

        // Front Wall
        const frontWall = createGrid(size, divisions, gridColor);
        frontWall.rotation.x = Math.PI / 2;
        frontWall.position.set(0, 5, 20);
        gridGroup.add(frontWall);

        // Left Wall
        const leftWall = createGrid(size, divisions, gridColor);
        leftWall.rotation.z = Math.PI / 2;
        leftWall.position.set(-20, 5, 0);
        gridGroup.add(leftWall);

        // Right Wall
        const rightWall = createGrid(size, divisions, gridColor);
        rightWall.rotation.z = Math.PI / 2;
        rightWall.position.set(20, 5, 0);
        gridGroup.add(rightWall);

        this.scene.add(gridGroup);

        this.initLights();
        this.initXR();

        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    private initLights(): void {
        // Ambient light for base illumination
        const ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
        this.scene.add(ambient);

        // Main directional light
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(5, 10, 7);
        light.castShadow = true;
        this.scene.add(light);
    }

    private initXR(): void {
        document.body.appendChild(VRButton.createButton(this.renderer));

        // Critical: Use local-floor for correct height in VR
        this.renderer.xr.setReferenceSpaceType('local-floor');

        // Balanced setting: 1.5x scale is sharp but performant
        this.renderer.xr.setFramebufferScaleFactor(1.5);

        const handModelFactory = new XRHandModelFactory();

        // Hand 1 (Right)
        this.hand1 = this.renderer.xr.getHand(0);
        this.hand1.userData.id = 'hand-right';

        // Visual Cursor 1 (Right)
        const cursorGeometry = new THREE.SphereGeometry(0.01, 16, 16);
        const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.8, transparent: true });
        this.cursor1 = new THREE.Mesh(cursorGeometry, cursorMaterial);
        this.scene.add(this.cursor1);

        this.hand1.add(handModelFactory.createHandModel(this.hand1));
        this.userGroup.add(this.hand1); // Add to user rig

        this.hand1.addEventListener('selectstart' as any, this.onSelectStart.bind(this) as any);
        this.hand1.addEventListener('selectend' as any, this.onSelectEnd.bind(this) as any);

        // Hand 2 (Left)
        this.hand2 = this.renderer.xr.getHand(1);
        this.hand2.userData.id = 'hand-left';

        // Visual Cursor 2 (Left)
        this.cursor2 = new THREE.Mesh(cursorGeometry, cursorMaterial.clone());
        this.scene.add(this.cursor2);

        this.hand2.add(handModelFactory.createHandModel(this.hand2));
        this.userGroup.add(this.hand2); // Add to user rig

        // Controllers (for when hands aren't tracked)
        const controllerModelFactory = new XRControllerModelFactory();

        // Controller 1 (Right)
        this.controller1 = this.renderer.xr.getController(0);
        this.controller1.userData.id = 'controller-right';
        this.controller1.addEventListener('selectstart' as any, this.onControllerSelectStart.bind(this) as any);
        this.controller1.addEventListener('selectend' as any, this.onControllerSelectEnd.bind(this) as any);
        // B button for redo (right controller)
        this.controller1.addEventListener('squeezestart' as any, () => this.drawingSystem.redo() as any);
        // A button for eraser toggle (right controller)
        this.controller1.addEventListener('selectstart' as any, (event: any) => {
            if (event.data && event.data.gamepad && event.data.gamepad.buttons[4]?.pressed) {
                this.toggleEraserMode();
            }
        });
        this.userGroup.add(this.controller1); // Add to user rig

        this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
        this.controllerGrip1.add(controllerModelFactory.createControllerModel(this.controllerGrip1));
        this.userGroup.add(this.controllerGrip1); // Add to user rig

        // Controller 2 (Left)
        this.controller2 = this.renderer.xr.getController(1);
        this.controller2.userData.id = 'controller-left';
        this.controller2.addEventListener('selectstart' as any, this.onControllerSelectStart.bind(this) as any);
        this.controller2.addEventListener('selectend' as any, this.onControllerSelectEnd.bind(this) as any);
        // Y button for undo (left controller)
        this.controller2.addEventListener('squeezestart' as any, () => this.drawingSystem.undo() as any);
        this.userGroup.add(this.controller2); // Add to user rig

        this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
        this.controllerGrip2.add(controllerModelFactory.createControllerModel(this.controllerGrip2));
        this.userGroup.add(this.controllerGrip2); // Add to user rig

        // Add line visual to controllers for pointing
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1)
        ]);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
        line.name = 'line';
        line.scale.z = 5;
        this.controller1.add(line.clone());
        this.controller2.add(line.clone());

        // Create teleport marker
        const markerGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.01, 32);
        const markerMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.6
        });
        this.teleportMarker = new THREE.Mesh(markerGeometry, markerMaterial);
        this.teleportMarker.rotation.x = Math.PI / 2;
        this.teleportMarker.visible = false;
        this.scene.add(this.teleportMarker);

        // Initialize color palette UI
        this.initColorPalette();
    }

    private initColorPalette(): void {
        this.paletteGroup = new THREE.Group();

        // Backing Panel (Container) with Rounded Corners
        const panelWidth = 0.8;
        const panelHeight = 0.22; // Increased height for text
        const panelDepth = 0.01;
        const radius = 0.05;

        const shape = new THREE.Shape();
        const x = -panelWidth / 2;
        const y = -panelHeight / 2;
        const width = panelWidth;
        const height = panelHeight;

        shape.moveTo(x, y + radius);
        shape.lineTo(x, y + height - radius);
        shape.quadraticCurveTo(x, y + height, x + radius, y + height);
        shape.lineTo(x + width - radius, y + height);
        shape.quadraticCurveTo(x + width, y + height, x + width, y + height - radius);
        shape.lineTo(x + width, y + radius);
        shape.quadraticCurveTo(x + width, y, x + width - radius, y);
        shape.lineTo(x + radius, y);
        shape.quadraticCurveTo(x, y, x, y + radius);

        const panelGeometry = new THREE.ExtrudeGeometry(shape, {
            depth: panelDepth,
            bevelEnabled: false
        });

        // Center the geometry
        panelGeometry.center();

        const panelMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff, // White
            roughness: 0.1,
            metalness: 0.0,
            transparent: true,
            opacity: 0.9
        });
        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.position.z = -0.02; // Slightly behind spheres
        this.paletteGroup.add(panel);

        // Border (Outline)
        const points = shape.getPoints();
        const borderGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const border = new THREE.LineLoop(borderGeometry, new THREE.LineBasicMaterial({ color: 0xcccccc }));
        // Align border with front face of panel
        border.position.z = panelDepth / 2 + 0.001;
        panel.add(border);

        // Eraser Instruction Label
        const label = this.createLabel("Press 'A' to Erase");
        label.position.set(0, -0.08, 0.02); // Moved down slightly
        this.paletteGroup.add(label);

        // Undo Button
        this.undoButton = this.createButton("Undo", 0.15, 0.06);
        this.undoButton.position.set(-0.25, -0.03, 0.02); // Left side, below colors
        this.undoButton.userData = { isButton: true, action: 'undo' };
        this.paletteGroup.add(this.undoButton);

        // Clear Button
        this.clearButton = this.createButton("Clear", 0.15, 0.06);
        this.clearButton.position.set(0.25, -0.03, 0.02); // Right side, below colors
        this.clearButton.userData = { isButton: true, action: 'clear' };
        this.paletteGroup.add(this.clearButton);

        const colors = this.colorPalette.getSlots();

        // Create 6 color spheres in horizontal row - FLOATING PANEL
        colors.forEach((color, index) => {
            const geometry = new THREE.SphereGeometry(0.04, 32, 32);
            const material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.5
            });
            const sphere = new THREE.Mesh(geometry, material);

            // Position in horizontal row (shifted up slightly)
            sphere.position.set(
                (index - 2.5) * 0.12,
                0.03, // Shifted up
                0
            );

            sphere.userData = { colorIndex: index };
            this.colorSpheres.push(sphere);
            this.paletteGroup.add(sphere);
        });

        // Position panel in front of user at chest height
        this.paletteGroup.position.set(0, 1.2, -0.6);
        this.scene.add(this.paletteGroup);
    }

    private createLabel(text: string): THREE.Mesh {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // High resolution for crisp text
        canvas.width = 1024;
        canvas.height = 256;

        if (context) {
            context.fillStyle = 'rgba(0,0,0,0)';
            context.clearRect(0, 0, canvas.width, canvas.height);

            context.font = 'Bold 80px Arial'; // Scaled up font
            context.fillStyle = '#888888';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(text, canvas.width / 2, canvas.height / 2);
        }

        const texture = new THREE.CanvasTexture(canvas);
        // Enable mipmaps with good filtering
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const geometry = new THREE.PlaneGeometry(0.6, 0.15);
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }

    private createButton(text: string, width: number, height: number): THREE.Mesh {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Match aspect ratio of geometry (0.15 / 0.06 = 2.5)
        // High resolution for VR legibility
        canvas.width = 1500;
        canvas.height = 600;

        if (context) {
            // Draw rounded rectangle
            const radius = 60; // Scaled radius
            context.beginPath();
            context.moveTo(radius, 0);
            context.lineTo(canvas.width - radius, 0);
            context.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
            context.lineTo(canvas.width, canvas.height - radius);
            context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
            context.lineTo(radius, canvas.height);
            context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
            context.lineTo(0, radius);
            context.quadraticCurveTo(0, 0, radius, 0);
            context.closePath();

            // White background (matching palette)
            context.fillStyle = '#ffffff';
            context.fill();

            // Light gray border - thicker for visibility
            context.lineWidth = 20;
            context.strokeStyle = '#cccccc';
            context.stroke();

            // Text - Scaled font
            context.font = 'Bold 200px Arial';
            context.fillStyle = '#333333';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            // Slight offset to center vertically better with the border
            context.fillText(text, canvas.width / 2, canvas.height / 2 + 15);
        }

        const texture = new THREE.CanvasTexture(canvas);
        // Enable mipmaps with good filtering
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });
        const geometry = new THREE.PlaneGeometry(width, height);
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }

    private onSelectStart(event: THREE.Event): void {
        const hand = event.target as THREE.Group;
        const cursor = hand === this.hand1 ? this.cursor1 : this.cursor2;
        // Use cursor position for hand drawing
        this.drawingSystem.startStroke(hand.userData.id, cursor.position);
        hand.userData.isPinching = true;
    }

    private onSelectEnd(event: THREE.Event): void {
        const hand = event.target as THREE.Group;
        const data = this.drawingSystem.endStroke(hand.userData.id);
        if (data) {
            this.networkManager.sendStroke(data);
        }
        hand.userData.isPinching = false;
    }

    private onControllerSelectStart(event: XRInputEvent): void {
        const controller = event.target;
        if (!controller) return;

        // Get controller position and direction
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);

        const raycaster = new THREE.Raycaster();
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        // 1. Check Shade Picker
        if (this.shadePickerGroup) {
            const shadeIntersects = raycaster.intersectObjects(this.shadeSpheres);
            if (shadeIntersects.length > 0) {
                const color = shadeIntersects[0].object.userData.shadeColor;
                this.colorPalette.customizeSlot(this.activeShadeSlotIndex, color);
                this.colorPalette.selectSlot(this.activeShadeSlotIndex);
                this.drawingSystem.setColor(color);

                const mainSphere = this.colorSpheres[this.activeShadeSlotIndex];
                (mainSphere.material as THREE.MeshStandardMaterial).color.setHex(color);
                (mainSphere.material as THREE.MeshStandardMaterial).emissive.setHex(color);

                this.updatePaletteHighlight();
                this.closeShadePicker();
                return; // Don't draw
            }
        }

        // 2. Check Undo Button
        const undoIntersect = raycaster.intersectObject(this.undoButton);
        if (undoIntersect.length > 0) {
            this.drawingSystem.undo();
            return;
        }

        // 3. Check Clear Button
        const clearIntersect = raycaster.intersectObject(this.clearButton);
        if (clearIntersect.length > 0) {
            this.drawingSystem.clear();
            return;
        }

        // 4. Check Main Palette
        const intersects = raycaster.intersectObjects(this.colorSpheres);
        if (intersects.length > 0) {
            const colorIndex = intersects[0].object.userData.colorIndex;
            const tapType = this.colorPalette.selectSlot(colorIndex);

            if (tapType === 'single') {
                this.drawingSystem.setColor(this.colorPalette.getActiveColor());
                this.updatePaletteHighlight();
                this.closeShadePicker();
            } else if (tapType === 'double') {
                this.openShadePicker(colorIndex);
            }
            return; // Don't draw
        }

        // Eraser mode - delete strokes
        if (this.isEraserMode) {
            const strokes = this.drawingSystem.getAllStrokeMeshes();
            const intersects = raycaster.intersectObjects(strokes);
            if (intersects.length > 0) {
                this.drawingSystem.deleteStroke(intersects[0].object as THREE.Mesh | Line2);
            }
            return;
        }

        // Normal drawing mode
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(controller.matrixWorld);
        this.drawingSystem.startStroke(controller.userData.id, position);
        controller.userData.isDrawing = true;
    }

    private onControllerSelectEnd(event: XRInputEvent): void {
        const controller = event.target;
        if (controller.userData.isDrawing) {
            const data = this.drawingSystem.endStroke(controller.userData.id);
            if (data) {
                this.networkManager.sendStroke(data);
            }
            controller.userData.isDrawing = false;
        }
    }

    private onWindowResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private render(): void {
        // Update Hands
        const hands = [
            { hand: this.hand1 as XRHandWithJoints, cursor: this.cursor1 },
            { hand: this.hand2 as XRHandWithJoints, cursor: this.cursor2 }
        ];

        hands.forEach(({ hand, cursor }) => {
            if (hand.joints && hand.joints['index-finger-tip']) {
                const indexTipPos = hand.joints['index-finger-tip'].position;

                // Update Cursor
                cursor.position.copy(indexTipPos);
                cursor.visible = true;

                if (hand.userData.isPinching) {
                    this.drawingSystem.updateStroke(hand.userData.id, indexTipPos);
                    (cursor.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00); // Green when drawing
                } else {
                    (cursor.material as THREE.MeshBasicMaterial).color.setHex(0xffffff); // White when hovering
                }
            } else {
                cursor.visible = false;
            }
        });

        // Check color palette interaction (right hand/controller)
        const hand1 = this.hand1 as XRHandWithJoints;
        if (hand1.joints && hand1.joints['index-finger-tip']) {
            const indexTipPos = hand1.joints['index-finger-tip'].position;
            this.checkColorPaletteInteraction(indexTipPos);
        }

        // Poll for X button (Teleport) on Left Controller
        const session = this.renderer.xr.getSession();
        if (session) {
            for (const source of session.inputSources) {
                if (source.handedness === 'left' && source.gamepad) {
                    const xPressed = source.gamepad.buttons[3]?.pressed;
                    if (xPressed && !this.wasXButtonPressed) {
                        this.onTeleportRequest(this.controller2);
                    }
                    this.wasXButtonPressed = xPressed;
                }
            }
        }

        // Update controller drawing position
        [this.controller1, this.controller2].forEach(controller => {
            if (controller && controller.visible && controller.userData.isDrawing) {
                const position = new THREE.Vector3();
                position.setFromMatrixPosition(controller.matrixWorld);
                this.drawingSystem.updateStroke(controller.userData.id, position);
            }
        });

        this.renderer.render(this.scene, this.camera);
    }

    private checkColorPaletteInteraction(fingerPos: THREE.Vector3): void {
        // 1. Check Shade Picker (if open)
        if (this.shadePickerGroup) {
            for (let i = 0; i < this.shadeSpheres.length; i++) {
                const sphere = this.shadeSpheres[i];
                const worldPos = new THREE.Vector3();
                sphere.getWorldPosition(worldPos);

                if (fingerPos.distanceTo(worldPos) < INTERACTION_DISTANCE_SHADE) {
                    const color = sphere.userData.shadeColor;
                    this.colorPalette.customizeSlot(this.activeShadeSlotIndex, color);
                    this.colorPalette.selectSlot(this.activeShadeSlotIndex);

                    this.drawingSystem.setColor(color);

                    const mainSphere = this.colorSpheres[this.activeShadeSlotIndex];
                    (mainSphere.material as THREE.MeshStandardMaterial).color.setHex(color);
                    (mainSphere.material as THREE.MeshStandardMaterial).emissive.setHex(color);

                    this.updatePaletteHighlight();
                    this.closeShadePicker();
                    return;
                }
            }
        }

        // 2. Check Undo Button
        const undoPos = new THREE.Vector3();
        this.undoButton.getWorldPosition(undoPos);
        if (fingerPos.distanceTo(undoPos) < INTERACTION_DISTANCE_BUTTON) {
            this.drawingSystem.undo();
            return;
        }

        // 3. Check Clear Button
        const clearPos = new THREE.Vector3();
        this.clearButton.getWorldPosition(clearPos);
        if (fingerPos.distanceTo(clearPos) < INTERACTION_DISTANCE_BUTTON) {
            this.drawingSystem.clear();
            return;
        }

        // 4. Check Main Slots
        for (let i = 0; i < this.colorSpheres.length; i++) {
            const sphere = this.colorSpheres[i];
            const worldPos = new THREE.Vector3();
            sphere.getWorldPosition(worldPos);

            const distance = fingerPos.distanceTo(worldPos);
            if (distance < INTERACTION_DISTANCE_SLOT) { // Touch threshold
                const tapType = this.colorPalette.selectSlot(i);

                if (tapType === 'single') {
                    // Update drawing color
                    this.drawingSystem.setColor(this.colorPalette.getActiveColor());
                    this.updatePaletteHighlight();
                    this.closeShadePicker();
                } else if (tapType === 'double') {
                    this.openShadePicker(i);
                }
                break;
            }
        }
    }

    private updatePaletteHighlight(): void {
        const activeIndex = this.colorPalette.getActiveSlotIndex();

        this.colorSpheres.forEach((sphere, index) => {
            const material = sphere.material as THREE.MeshStandardMaterial;
            if (index === activeIndex) {
                // Highlight active color
                material.emissiveIntensity = 0.8;
                sphere.scale.setScalar(1.3);
            } else {
                material.emissiveIntensity = 0.3;
                sphere.scale.setScalar(1.0);
            }
        });
    }

    private openShadePicker(slotIndex: number): void {
        this.closeShadePicker(); // Close existing if any
        this.activeShadeSlotIndex = slotIndex;

        this.shadePickerGroup = new THREE.Group();
        const baseColor = this.colorPalette.getBaseColor(slotIndex);
        const shades = this.colorPalette.getShades(baseColor);

        shades.forEach((color, index) => {
            const geometry = new THREE.SphereGeometry(0.03, 32, 32);
            const material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.5
            });
            const sphere = new THREE.Mesh(geometry, material);

            // Position vertically above the slot
            const slotX = (slotIndex - 2.5) * 0.12;
            sphere.position.set(slotX, 0.1 + (index * 0.07), 0);

            sphere.userData = { shadeColor: color };
            this.shadeSpheres.push(sphere);
            this.shadePickerGroup.add(sphere);
        });

        this.paletteGroup.add(this.shadePickerGroup);
    }

    private closeShadePicker(): void {
        if (this.shadePickerGroup) {
            this.paletteGroup.remove(this.shadePickerGroup);
            this.shadeSpheres.forEach(s => {
                (s.geometry as THREE.BufferGeometry).dispose();
                (s.material as THREE.Material).dispose();
            });
            this.shadeSpheres = [];
            this.shadePickerGroup = null as any;
        }
        this.activeShadeSlotIndex = -1;
    }

    private toggleEraserMode(): void {
        this.isEraserMode = !this.isEraserMode;
        this.updateControllerRayColor();
        console.log(`Eraser mode: ${this.isEraserMode ? 'ON' : 'OFF'}`);
    }

    private updateControllerRayColor(): void {
        const line = this.controller1.getObjectByName('line') as THREE.Line;
        if (line) {
            const material = line.material as THREE.LineBasicMaterial;
            material.color.setHex(this.isEraserMode ? 0xff0000 : 0xffffff);
        }
    }

    private onTeleportRequest(controller: THREE.Group): void {
        if (!controller) return;

        // Raycast from left controller to find floor
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);

        const raycaster = new THREE.Raycaster();
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        // Check for floor intersection (y = 0)
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(floorPlane, target);

        if (target) {
            // Move camera to target position (keep current height)
            const offset = this.camera.position.clone().sub(this.renderer.xr.getCamera().position);
            this.camera.position.set(target.x + offset.x, this.camera.position.y, target.z + offset.z);
            console.log(`Teleported to: ${target.x.toFixed(2)}, ${target.z.toFixed(2)}`);
        }
    }
}

new App();
