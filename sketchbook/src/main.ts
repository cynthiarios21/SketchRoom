import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { ColorPalette } from './ColorPalette';
import { DrawingSystem } from './drawing';
import { NetworkManager } from './networking';
import { ParticleSystem } from './ParticleSystem';

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

    // Drawing Preview
    private previewSphere!: THREE.Mesh;

    // Visual Effects
    private particleSystem!: ParticleSystem;
    private lastDrawPosition: THREE.Vector3 = new THREE.Vector3();
    private clock: THREE.Clock = new THREE.Clock();

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
        // Create starfield background
        this.createStarfield();

        // Enhanced fog with subtle color tint
        this.scene.fog = new THREE.FogExp2(0x0a1a2e, 0.012); // Darker, more atmospheric

        const gridGroup = new THREE.Group();

        // Helper to create modern grids with glow
        const createGrid = (size: number, divisions: number, color: number, opacity: number = 0.15) => {
            const grid = new THREE.GridHelper(size, divisions, color, color);
            const material = grid.material as THREE.LineBasicMaterial;
            material.transparent = true;
            material.opacity = opacity;
            material.color.setHex(color);
            return grid;
        };

        const size = 40;
        const divisions = 40;

        // Floor (Reflective with gradient)
        const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x0a1929, // Dark blue-gray
            roughness: 0.3,
            metalness: 0.6,
            emissive: 0x0a1929,
            emissiveIntensity: 0.1
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Floor Grid (Cyan tint)
        const floorGrid = createGrid(size, divisions, 0x00d4ff, 0.25);
        gridGroup.add(floorGrid);

        // Ceiling (Purple tint, more subtle)
        const ceiling = createGrid(size, divisions, 0x9d4edd, 0.1);
        ceiling.position.y = 10;
        gridGroup.add(ceiling);

        // Back Wall (Blue tint)
        const backWall = createGrid(size, divisions, 0x4cc9f0, 0.15);
        backWall.rotation.x = Math.PI / 2;
        backWall.position.set(0, 5, -20);
        gridGroup.add(backWall);

        // Front Wall (Blue tint)
        const frontWall = createGrid(size, divisions, 0x4cc9f0, 0.15);
        frontWall.rotation.x = Math.PI / 2;
        frontWall.position.set(0, 5, 20);
        gridGroup.add(frontWall);

        // Left Wall (Purple tint)
        const leftWall = createGrid(size, divisions, 0x7209b7, 0.15);
        leftWall.rotation.z = Math.PI / 2;
        leftWall.position.set(-20, 5, 0);
        gridGroup.add(leftWall);

        // Right Wall (Purple tint)
        const rightWall = createGrid(size, divisions, 0x7209b7, 0.15);
        rightWall.rotation.z = Math.PI / 2;
        rightWall.position.set(20, 5, 0);
        gridGroup.add(rightWall);

        this.scene.add(gridGroup);

        // Initialize particle system
        this.particleSystem = new ParticleSystem(this.scene);

        // Add ambient floating particles
        this.createAmbientParticles();

        this.initLights();
        this.initXR();

        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    private initLights(): void {
        // Ambient light for base illumination (cooler tone)
        const ambient = new THREE.HemisphereLight(0x4cc9f0, 0x1a1a2e, 0.4);
        this.scene.add(ambient);

        // Main directional light (key light)
        const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
        mainLight.position.set(5, 10, 7);
        mainLight.castShadow = true;

        // Enhanced shadow quality
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 50;
        mainLight.shadow.camera.left = -20;
        mainLight.shadow.camera.right = 20;
        mainLight.shadow.camera.top = 20;
        mainLight.shadow.camera.bottom = -20;
        this.scene.add(mainLight);

        // Soft shadows
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Accent Light 1 - Cyan (left side)
        const accentLight1 = new THREE.PointLight(0x00d4ff, 0.8, 15);
        accentLight1.position.set(-8, 3, -5);
        this.scene.add(accentLight1);

        // Accent Light 2 - Magenta (right side)
        const accentLight2 = new THREE.PointLight(0xff006e, 0.8, 15);
        accentLight2.position.set(8, 3, -5);
        this.scene.add(accentLight2);

        // Accent Light 3 - Yellow (back)
        const accentLight3 = new THREE.PointLight(0xffbe0b, 0.6, 12);
        accentLight3.position.set(0, 4, 10);
        this.scene.add(accentLight3);

        // Rim light (purple, from behind)
        const rimLight = new THREE.SpotLight(0x9d4edd, 0.5);
        rimLight.position.set(0, 5, -15);
        rimLight.angle = Math.PI / 4;
        rimLight.penumbra = 0.3;
        this.scene.add(rimLight);
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

        // Enhanced Cursor 1 (Right) - Glowing Ring
        const cursorGeometry = new THREE.TorusGeometry(0.012, 0.003, 16, 32);
        const cursorMaterial = new THREE.MeshBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.9
        });
        this.cursor1 = new THREE.Mesh(cursorGeometry, cursorMaterial);
        this.cursor1.userData.emissiveColor = 0x00d4ff;
        this.scene.add(this.cursor1);

        this.hand1.add(handModelFactory.createHandModel(this.hand1));
        this.userGroup.add(this.hand1); // Add to user rig

        this.hand1.addEventListener('selectstart' as any, this.onSelectStart.bind(this) as any);
        this.hand1.addEventListener('selectend' as any, this.onSelectEnd.bind(this) as any);

        // Hand 2 (Left)
        this.hand2 = this.renderer.xr.getHand(1);
        this.hand2.userData.id = 'hand-left';

        // Enhanced Cursor 2 (Left) - Glowing Ring
        this.cursor2 = new THREE.Mesh(cursorGeometry.clone(), cursorMaterial.clone());
        this.cursor2.userData.emissiveColor = 0x00d4ff;
        this.scene.add(this.cursor2);

        // Drawing Preview Sphere
        const previewGeometry = new THREE.SphereGeometry(0.005, 16, 16); // Will be updated dynamically
        const previewMaterial = new THREE.MeshStandardMaterial({
            color: this.colorPalette.getActiveColor(),
            emissive: this.colorPalette.getActiveColor(),
            emissiveIntensity: 0.6,
            transparent: true,
            opacity: 0.5,
            roughness: 0.3,
            metalness: 0.2
        });
        this.previewSphere = new THREE.Mesh(previewGeometry, previewMaterial);
        this.previewSphere.visible = false;
        this.scene.add(this.previewSphere);

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

        // VR-Optimized Panel (Vertical orientation)
        const panelWidth = 0.4;  // Narrower
        const panelHeight = 0.6; // Taller for vertical layout
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

        panelGeometry.center();

        // Glassmorphism panel material
        const panelMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a2e,
            roughness: 0.2,
            metalness: 0.1,
            transparent: true,
            opacity: 0.4,
            transmission: 0.3,
            thickness: 0.5,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1
        });
        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.position.z = -0.02;
        this.paletteGroup.add(panel);

        // Glowing border with animation
        const points = shape.getPoints();
        const borderGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const border = new THREE.LineLoop(borderGeometry, new THREE.LineBasicMaterial({
            color: 0x00d4ff,
            transparent: true,
            opacity: 0.8
        }));
        border.position.z = panelDepth / 2 + 0.001;
        panel.add(border);
        panel.userData.border = border;

        // Active Color Indicator (Center, prominent)
        const activeGeometry = new THREE.SphereGeometry(0.05, 32, 32);
        const activeMaterial = new THREE.MeshStandardMaterial({
            color: this.colorPalette.getActiveColor(),
            emissive: this.colorPalette.getActiveColor(),
            emissiveIntensity: 1.0,
            roughness: 0.2,
            metalness: 0.3
        });
        const activeIndicator = new THREE.Mesh(activeGeometry, activeMaterial);
        activeIndicator.position.set(0, 0.05, 0.02);
        activeIndicator.userData.isActiveIndicator = true;
        this.paletteGroup.add(activeIndicator);

        // "Active Color" label
        const activeLabel = this.createLabel("Active Color", 0xaaaaaa);
        activeLabel.scale.setScalar(0.5);
        activeLabel.position.set(0, -0.02, 0.02);
        this.paletteGroup.add(activeLabel);

        const colors = this.colorPalette.getSlots();
        const colorNames = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple"];

        // Arc layout for color spheres (180° semicircle)
        const arcRadius = 0.15;
        const arcStartAngle = Math.PI; // Start at left (180°)
        const arcEndAngle = 0; // End at right (0°)
        const angleStep = (arcStartAngle - arcEndAngle) / (colors.length - 1);

        colors.forEach((color, index) => {
            // Larger spheres for VR (50% bigger)
            const geometry = new THREE.SphereGeometry(0.06, 32, 32);
            const material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.8,
                roughness: 0.3,
                metalness: 0.2
            });
            const sphere = new THREE.Mesh(geometry, material);

            // Position in arc
            const angle = arcStartAngle - (angleStep * index);
            const x = Math.cos(angle) * arcRadius;
            const y = Math.sin(angle) * arcRadius * 0.5 + 0.15; // Compressed vertically, shifted up

            sphere.position.set(x, y, 0);
            sphere.userData = {
                colorIndex: index,
                defaultScale: 1.0,
                hoverScale: 1.2
            };
            this.colorSpheres.push(sphere);
            this.paletteGroup.add(sphere);

            // Color label below each sphere
            const label = this.createLabel(colorNames[index], 0x888888);
            label.scale.setScalar(0.3);
            label.position.set(x, y - 0.08, 0.01);
            this.paletteGroup.add(label);
        });

        // Brush Size Selector (S, M, L)
        const sizes = [
            { label: 'S', size: 0.002, radius: 0.015 },
            { label: 'M', size: 0.005, radius: 0.020 },
            { label: 'L', size: 0.010, radius: 0.025 }
        ];

        const sizeButtons: THREE.Mesh[] = [];
        sizes.forEach((sizeOption, index) => {
            // Create circular button with size-appropriate radius
            const geometry = new THREE.CircleGeometry(sizeOption.radius, 32);
            const material = new THREE.MeshStandardMaterial({
                color: 0x4cc9f0,
                emissive: 0x4cc9f0,
                emissiveIntensity: 0.3,
                roughness: 0.3,
                metalness: 0.2,
                transparent: true,
                opacity: 0.8
            });
            const button = new THREE.Mesh(geometry, material);

            // Position horizontally below active color
            const xPos = (index - 1) * 0.07; // Centered, spaced 0.07m apart
            button.position.set(xPos, -0.12, 0.02);

            button.userData = {
                isSizeButton: true,
                size: sizeOption.size,
                sizeIndex: index,
                defaultScale: 1.0,
                hoverScale: 1.15
            };

            sizeButtons.push(button);
            this.paletteGroup.add(button);

            // Size label
            const label = this.createLabel(sizeOption.label, 0xaaaaaa);
            label.scale.setScalar(0.25);
            label.position.set(xPos, -0.12, 0.03);
            this.paletteGroup.add(label);
        });

        // Store size buttons for later access
        this.paletteGroup.userData.sizeButtons = sizeButtons;

        // Set default size (Medium)
        this.drawingSystem.setSize(0.005);
        (sizeButtons[1].material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
        sizeButtons[1].scale.setScalar(1.2);


        // Larger Undo Button (33% bigger)
        this.undoButton = this.createButton("Undo", 0.20, 0.08);
        this.undoButton.position.set(-0.1, -0.22, 0.02);
        this.undoButton.userData = {
            isButton: true,
            action: 'undo',
            defaultScale: 1.0,
            hoverScale: 1.1
        };
        this.paletteGroup.add(this.undoButton);

        // Larger Clear Button (33% bigger)
        this.clearButton = this.createButton("Clear", 0.20, 0.08);
        this.clearButton.position.set(0.1, -0.22, 0.02);
        this.clearButton.userData = {
            isButton: true,
            action: 'clear',
            defaultScale: 1.0,
            hoverScale: 1.1,
            requiresConfirmation: false
        };
        this.paletteGroup.add(this.clearButton);

        // Position palette for better VR ergonomics
        // Lower height (1.3m) and closer distance (0.3m for easy reach)
        this.paletteGroup.position.set(0, 1.3, -0.3);

        // Tilt 15° upward for better viewing angle
        this.paletteGroup.rotation.x = Math.PI / 12;

        this.scene.add(this.paletteGroup);
    }

    private createLabel(text: string, color: number = 0x888888): THREE.Mesh {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // High resolution for crisp text
        canvas.width = 1024;
        canvas.height = 256;

        if (context) {
            context.fillStyle = 'rgba(0,0,0,0)';
            context.clearRect(0, 0, canvas.width, canvas.height);

            context.font = 'Bold 80px Arial';
            const hexColor = '#' + color.toString(16).padStart(6, '0');
            context.fillStyle = hexColor;
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

            // Dark semi-transparent background (matching glassmorphism theme)
            context.fillStyle = 'rgba(26, 26, 46, 0.6)';
            context.fill();

            // Cyan glowing border
            context.lineWidth = 20;
            context.strokeStyle = '#00d4ff';
            context.stroke();

            // Light text for visibility
            context.font = 'Bold 200px Arial';
            context.fillStyle = '#ffffff';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
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

                // Update Cursor position and orientation
                cursor.position.copy(indexTipPos);
                cursor.visible = true;

                // Rotate cursor for animation
                cursor.rotation.z += 0.05;

                // Orient cursor to face camera
                cursor.lookAt(this.camera.position);

                // Match cursor color to brush color when idle
                const currentColor = this.colorPalette.getActiveColor();
                const cursorMat = cursor.material as THREE.MeshBasicMaterial;
                if (!hand.userData.isPinching) {
                    cursorMat.color.setHex(currentColor);
                }

                if (hand.userData.isPinching) {
                    this.drawingSystem.updateStroke(hand.userData.id, indexTipPos);
                    (cursor.material as THREE.MeshBasicMaterial).color.setHex(0x00ff88); // Bright green when drawing

                    // Emit drawing particles
                    if (this.lastDrawPosition.distanceTo(indexTipPos) > 0.01) {
                        this.particleSystem.emitTrail(
                            indexTipPos,
                            new THREE.Color(currentColor)
                        );
                        this.lastDrawPosition.copy(indexTipPos);
                    }
                } else {
                    (cursor.material as THREE.MeshBasicMaterial).color.setHex(currentColor); // Match brush color when idle
                }
            } else {
                cursor.visible = false;
            }
        });

        // Update Drawing Preview Sphere (right hand only)
        const hand1 = this.hand1 as XRHandWithJoints;
        if (hand1.joints && hand1.joints['index-finger-tip']) {
            const indexTipPos = hand1.joints['index-finger-tip'].position;
            const isDrawing = hand1.userData.isPinching;

            // Show preview when not drawing
            if (!isDrawing) {
                this.previewSphere.position.copy(indexTipPos);
                this.previewSphere.visible = true;

                // Update preview to match current brush settings
                const currentColor = this.colorPalette.getActiveColor();
                const currentSize = this.drawingSystem.getSize();

                // Update size if changed
                const currentScale = this.previewSphere.scale.x;
                const targetScale = currentSize / 0.005; // 0.005 is base size
                if (Math.abs(currentScale - targetScale) > 0.01) {
                    this.previewSphere.scale.setScalar(targetScale);
                }

                // Update color if changed
                const material = this.previewSphere.material as THREE.MeshStandardMaterial;
                if (material.color.getHex() !== currentColor) {
                    material.color.setHex(currentColor);
                    material.emissive.setHex(currentColor);
                }
            } else {
                this.previewSphere.visible = false;
            }
        } else {
            this.previewSphere.visible = false;
        }

        // Check color palette interaction (right hand/controller)
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

        // Animate palette border (pulse effect)
        if (this.paletteGroup) {
            const panel = this.paletteGroup.children.find(child => child.userData.border);
            if (panel && panel.userData.border) {
                const border = panel.userData.border as THREE.LineLoop;
                const time = Date.now() * 0.001;
                (border.material as THREE.LineBasicMaterial).opacity = 0.6 + Math.sin(time * 2) * 0.2;
            }
        }

        // Update button states
        this.updateButtonStates();

        // Update particle system
        const deltaTime = this.clock.getDelta();
        this.particleSystem.update(deltaTime);

        // Animate starfield (twinkling)
        const starfield = this.scene.userData.starfield as THREE.Points;
        if (starfield) {
            const time = Date.now() * 0.001;
            const material = starfield.material as THREE.PointsMaterial;
            material.opacity = 0.7 + Math.sin(time * 0.5) * 0.1; // Gentle pulsing
        }

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

        // 4. Check Main Slots with hover effects
        for (let i = 0; i < this.colorSpheres.length; i++) {
            const sphere = this.colorSpheres[i];
            const worldPos = new THREE.Vector3();
            sphere.getWorldPosition(worldPos);

            const distance = fingerPos.distanceTo(worldPos);
            const hoverDistance = INTERACTION_DISTANCE_SLOT * 2; // Larger hover zone

            // Hover effect
            if (distance < hoverDistance) {
                sphere.scale.setScalar(sphere.userData.hoverScale);
                (sphere.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2;
            } else {
                // Reset to default if not active
                const activeIndex = this.colorPalette.getActiveSlotIndex();
                if (i !== activeIndex) {
                    sphere.scale.setScalar(sphere.userData.defaultScale);
                    (sphere.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
                }
            }

            // Touch interaction
            if (distance < INTERACTION_DISTANCE_SLOT) {
                const tapType = this.colorPalette.selectSlot(i);

                if (tapType === 'single') {
                    const selectedColor = this.colorPalette.getActiveColor();
                    this.drawingSystem.setColor(selectedColor);
                    this.updatePaletteHighlight();
                    this.closeShadePicker();

                    // Emit particle burst on color selection
                    this.particleSystem.emitBurst(
                        worldPos,
                        new THREE.Color(selectedColor)
                    );
                } else if (tapType === 'double') {
                    this.openShadePicker(i);
                }
                break;
            }
        }

        // Hover effects for buttons
        [this.undoButton, this.clearButton].forEach(button => {
            // Skip if button is disabled
            if (button.userData.disabled) {
                return;
            }

            const worldPos = new THREE.Vector3();
            button.getWorldPosition(worldPos);
            const distance = fingerPos.distanceTo(worldPos);
            const hoverDistance = INTERACTION_DISTANCE_BUTTON * 1.5;

            if (distance < hoverDistance) {
                button.scale.setScalar(button.userData.hoverScale);
            } else {
                button.scale.setScalar(button.userData.defaultScale);
            }
        });

        // Hover and interaction for size buttons
        const sizeButtons = this.paletteGroup.userData.sizeButtons as THREE.Mesh[];
        if (sizeButtons) {
            sizeButtons.forEach((button, index) => {
                const worldPos = new THREE.Vector3();
                button.getWorldPosition(worldPos);
                const distance = fingerPos.distanceTo(worldPos);
                const hoverDistance = INTERACTION_DISTANCE_BUTTON * 1.5;

                // Hover effect (only if not active)
                const currentSize = this.drawingSystem.getSize();
                const isActive = Math.abs(button.userData.size - currentSize) < 0.001;

                if (distance < hoverDistance && !isActive) {
                    button.scale.setScalar(button.userData.hoverScale);
                } else if (!isActive) {
                    button.scale.setScalar(button.userData.defaultScale);
                }

                // Click interaction
                if (distance < INTERACTION_DISTANCE_BUTTON) {
                    // Update size in drawing system
                    this.drawingSystem.setSize(button.userData.size);

                    // Update visual feedback for all size buttons
                    sizeButtons.forEach((btn, idx) => {
                        const mat = btn.material as THREE.MeshStandardMaterial;
                        if (idx === index) {
                            mat.emissiveIntensity = 0.8;
                            btn.scale.setScalar(1.2);
                        } else {
                            mat.emissiveIntensity = 0.3;
                            btn.scale.setScalar(1.0);
                        }
                    });
                }
            });
        }
    }

    private updatePaletteHighlight(): void {
        const activeIndex = this.colorPalette.getActiveSlotIndex();
        const activeColor = this.colorPalette.getActiveColor();

        // Update active color indicator
        const activeIndicator = this.paletteGroup.children.find(
            child => child.userData.isActiveIndicator
        ) as THREE.Mesh;
        if (activeIndicator && activeIndicator.material instanceof THREE.MeshStandardMaterial) {
            activeIndicator.material.color.setHex(activeColor);
            activeIndicator.material.emissive.setHex(activeColor);
        }

        this.colorSpheres.forEach((sphere, index) => {
            const material = sphere.material as THREE.MeshStandardMaterial;
            if (index === activeIndex) {
                // Highlight active color
                material.emissiveIntensity = 1.2;
                sphere.scale.setScalar(1.3);
            } else {
                material.emissiveIntensity = 0.8;
                sphere.scale.setScalar(1.0);
            }
        });
    }

    private updateButtonStates(): void {
        // Update Undo button state
        const canUndo = this.drawingSystem.canUndo();
        const undoMaterial = this.undoButton.material as THREE.MeshBasicMaterial;
        if (canUndo) {
            undoMaterial.opacity = 1.0;
            this.undoButton.userData.disabled = false;
        } else {
            undoMaterial.opacity = 0.4;
            this.undoButton.userData.disabled = true;
            this.undoButton.scale.setScalar(1.0); // Reset scale if disabled
        }

        // Update Clear button state (always enabled if there are strokes)
        const clearMaterial = this.clearButton.material as THREE.MeshBasicMaterial;
        if (canUndo) { // Same condition as undo
            clearMaterial.opacity = 1.0;
            this.clearButton.userData.disabled = false;
        } else {
            clearMaterial.opacity = 0.4;
            this.clearButton.userData.disabled = true;
            this.clearButton.scale.setScalar(1.0);
        }
    }

    private createStarfield(): void {
        // Create starfield with thousands of stars
        const starCount = 2000;
        const positions: number[] = [];
        const colors: number[] = [];
        const sizes: number[] = [];

        const starColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0x00d4ff), // Cyan
            new THREE.Color(0x9d4edd), // Purple
        ];

        for (let i = 0; i < starCount; i++) {
            // Random position in a large sphere
            const radius = 50 + Math.random() * 50;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            positions.push(x, y, z);

            // Random color (mostly white, some colored)
            const colorChoice = Math.random();
            let color: THREE.Color;
            if (colorChoice < 0.7) {
                color = starColors[0]; // 70% white
            } else if (colorChoice < 0.85) {
                color = starColors[1]; // 15% cyan
            } else {
                color = starColors[2]; // 15% purple
            }

            colors.push(color.r, color.g, color.b);

            // Random size
            sizes.push(0.5 + Math.random() * 1.5);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 1.0,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        const stars = new THREE.Points(geometry, material);
        this.scene.add(stars);

        // Store for animation
        this.scene.userData.starfield = stars;

        // Set dark background color
        this.scene.background = new THREE.Color(0x000510);
    }

    private createAmbientParticles(): void {
        // Emit ambient particles throughout the environment
        const colors = [
            new THREE.Color(0x00d4ff), // Cyan
            new THREE.Color(0x9d4edd), // Purple
            new THREE.Color(0xffffff)  // White
        ];

        for (let i = 0; i < 80; i++) {
            const position = new THREE.Vector3(
                (Math.random() - 0.5) * 10,
                Math.random() * 5,
                (Math.random() - 0.5) * 10
            );

            const color = colors[Math.floor(Math.random() * colors.length)];

            this.particleSystem.emit({
                position,
                color,
                count: 1,
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.05,
                    (Math.random() - 0.5) * 0.05,
                    (Math.random() - 0.5) * 0.05
                ),
                spread: 0,
                lifetime: 999, // Very long lifetime for ambient particles
                size: 0.01
            });
        }
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
