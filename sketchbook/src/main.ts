import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { NetworkManager } from './networking';
import { DrawingSystem } from './drawing';
import { UIManager } from './ui';

class App {
    private container: HTMLElement;
    private camera: THREE.PerspectiveCamera;
    private scene: THREE.Scene;
    private renderer: THREE.WebGLRenderer;
    private hand1!: THREE.Group;
    private hand2!: THREE.Group;
    private cursor!: THREE.Mesh;

    private drawingSystem: DrawingSystem;
    private uiManager: UIManager;
    private networkManager: NetworkManager;

    private pinching: boolean = false;

    constructor() {
        this.container = document.createElement('div');
        document.body.appendChild(this.container);

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 1.6, 3);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.xr.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.5;
        this.container.appendChild(this.renderer.domElement);

        this.initScene();
        this.initLights();
        this.initXR();

        // Systems
        this.drawingSystem = new DrawingSystem(this.scene);
        this.uiManager = new UIManager(this.scene, this.drawingSystem);
        this.networkManager = new NetworkManager();

        // Networking Events
        this.networkManager.on('stroke-received', (data: any) => {
            this.drawingSystem.drawRemoteStroke(data);
        });

        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    private initScene(): void {
        const floorGeometry = new THREE.PlaneGeometry(20, 20);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Skybox
        const sky = new Sky();
        sky.scale.setScalar(450000);
        this.scene.add(sky);

        const sun = new THREE.Vector3();
        const effectController = {
            turbidity: 10,
            rayleigh: 3,
            mieCoefficient: 0.005,
            mieDirectionalG: 0.7,
            elevation: 2,
            azimuth: 180
        };

        const uniforms = sky.material.uniforms;
        uniforms['turbidity'].value = effectController.turbidity;
        uniforms['rayleigh'].value = effectController.rayleigh;
        uniforms['mieCoefficient'].value = effectController.mieCoefficient;
        uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

        const phi = THREE.MathUtils.degToRad(90 - effectController.elevation);
        const theta = THREE.MathUtils.degToRad(effectController.azimuth);
        sun.setFromSphericalCoords(1, phi, theta);
        uniforms['sunPosition'].value.copy(sun);
    }

    private initLights(): void {
        this.scene.add(new THREE.HemisphereLight(0x808080, 0x606060));

        const light = new THREE.DirectionalLight(0xffffff);
        light.position.set(0, 6, 0);
        light.castShadow = true;
        this.scene.add(light);
    }

    private initXR(): void {
        document.body.appendChild(VRButton.createButton(this.renderer, {
            optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
        }));

        const handModelFactory = new XRHandModelFactory();

        // Hand 1 (Right)
        this.hand1 = this.renderer.xr.getHand(0);

        // Visual Cursor (Feedback)
        const cursorGeometry = new THREE.SphereGeometry(0.01, 16, 16);
        const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.8, transparent: true });
        this.cursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
        this.scene.add(this.cursor);

        this.hand1.add(handModelFactory.createHandModel(this.hand1));
        this.scene.add(this.hand1);

        this.hand1.addEventListener('selectstart', this.onSelectStart.bind(this) as any);
        this.hand1.addEventListener('selectend', this.onSelectEnd.bind(this) as any);

        // Hand 2 (Left)
        this.hand2 = this.renderer.xr.getHand(1);
        this.hand2.add(handModelFactory.createHandModel(this.hand2));
        this.scene.add(this.hand2);
    }

    private onSelectStart(event: any): void {
        const controller = event.target;
        const indexTip = controller.joints['index-finger-tip'];
        if (indexTip) {
            this.drawingSystem.startStroke(indexTip.position);
            this.pinching = true;
        }
    }

    private onSelectEnd(event: any): void {
        const strokeData = this.drawingSystem.endStroke();
        if (strokeData) {
            this.networkManager.sendStroke(strokeData);
        }
        this.pinching = false;
    }

    private onWindowResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private render(): void {
        // Update Drawing
        // @ts-ignore - joints property exists on XRHand
        if (this.hand1.joints && this.hand1.joints['index-finger-tip']) {
            // @ts-ignore
            const indexTipPos = this.hand1.joints['index-finger-tip'].position;

            // Update Cursor
            this.cursor.position.copy(indexTipPos);
            this.cursor.visible = true;

            if (this.pinching) {
                this.drawingSystem.updateStroke(indexTipPos);
                (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00); // Green when drawing
            } else {
                (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(0xffffff); // White when hovering
            }
        } else {
            this.cursor.visible = false;
        }

        // Update UI (Palm check)
        // @ts-ignore
        if (this.hand2.joints && this.hand2.joints['wrist']) {
            // @ts-ignore
            const wrist = this.hand2.joints['wrist'];
            // Logic for palm up check would go here
        }

        // Check UI interaction
        // @ts-ignore
        if (this.hand1.joints && this.hand1.joints['index-finger-tip']) {
            // @ts-ignore
            this.uiManager.checkIntersection(this.hand1.joints['index-finger-tip'].position);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

new App();
