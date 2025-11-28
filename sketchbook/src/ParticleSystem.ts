import * as THREE from 'three';

interface ParticleConfig {
    position: THREE.Vector3;
    color: THREE.Color;
    count: number;
    velocity?: THREE.Vector3;
    spread?: number;
    lifetime?: number;
    size?: number;
}

class Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    color: THREE.Color;
    lifetime: number;
    maxLifetime: number;
    size: number;
    alpha: number;

    constructor(
        position: THREE.Vector3,
        velocity: THREE.Vector3,
        color: THREE.Color,
        lifetime: number,
        size: number
    ) {
        this.position = position.clone();
        this.velocity = velocity.clone();
        this.color = color.clone();
        this.lifetime = 0;
        this.maxLifetime = lifetime;
        this.size = size;
        this.alpha = 1.0;
    }

    update(deltaTime: number): boolean {
        this.lifetime += deltaTime;

        // Update position
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));

        // Apply gravity
        this.velocity.y -= 0.5 * deltaTime;

        // Fade out based on lifetime
        this.alpha = 1.0 - (this.lifetime / this.maxLifetime);

        // Return true if particle is still alive
        return this.lifetime < this.maxLifetime;
    }
}

export class ParticleSystem {
    private scene: THREE.Scene;
    private particles: Particle[] = [];
    private geometry: THREE.BufferGeometry;
    private material: THREE.PointsMaterial;
    private points: THREE.Points;
    private maxParticles: number = 300;

    constructor(scene: THREE.Scene) {
        this.scene = scene;

        // Create geometry for particles
        this.geometry = new THREE.BufferGeometry();

        // Create material
        this.material = new THREE.PointsMaterial({
            size: 0.01,
            transparent: true,
            opacity: 0.8,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Create points object
        this.points = new THREE.Points(this.geometry, this.material);
        this.scene.add(this.points);

        // Initialize buffers
        this.updateGeometry();
    }

    public emit(config: ParticleConfig): void {
        const {
            position,
            color,
            count,
            velocity = new THREE.Vector3(0, 0.1, 0),
            spread = 0.1,
            lifetime = 1.0,
            size = 0.01
        } = config;

        for (let i = 0; i < count; i++) {
            // Don't exceed max particles
            if (this.particles.length >= this.maxParticles) {
                break;
            }

            // Random velocity with spread
            const vel = new THREE.Vector3(
                velocity.x + (Math.random() - 0.5) * spread,
                velocity.y + (Math.random() - 0.5) * spread,
                velocity.z + (Math.random() - 0.5) * spread
            );

            const particle = new Particle(
                position,
                vel,
                color,
                lifetime,
                size
            );

            this.particles.push(particle);
        }
    }

    public emitBurst(position: THREE.Vector3, color: THREE.Color, count: number = 15): void {
        this.emit({
            position,
            color,
            count,
            velocity: new THREE.Vector3(0, 0.2, 0),
            spread: 0.3,
            lifetime: 0.5,
            size: 0.015
        });
    }

    public emitTrail(position: THREE.Vector3, color: THREE.Color): void {
        this.emit({
            position,
            color,
            count: 2,
            velocity: new THREE.Vector3(0, 0, 0),
            spread: 0.02,
            lifetime: 0.3,
            size: 0.008
        });
    }

    public update(deltaTime: number): void {
        // Update all particles
        this.particles = this.particles.filter(particle => particle.update(deltaTime));

        // Update geometry
        this.updateGeometry();
    }

    private updateGeometry(): void {
        const positions: number[] = [];
        const colors: number[] = [];

        this.particles.forEach(particle => {
            positions.push(particle.position.x, particle.position.y, particle.position.z);
            colors.push(particle.color.r, particle.color.g, particle.color.b);
        });

        this.geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        this.geometry.setAttribute(
            'color',
            new THREE.Float32BufferAttribute(colors, 3)
        );

        // Update material opacity based on average particle alpha
        if (this.particles.length > 0) {
            const avgAlpha = this.particles.reduce((sum, p) => sum + p.alpha, 0) / this.particles.length;
            this.material.opacity = avgAlpha * 0.8;
        }
    }

    public dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
        this.scene.remove(this.points);
    }
}
