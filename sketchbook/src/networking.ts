// Simple Event Emitter for browser compatibility
type Listener = (data: any) => void;

class SimpleEventEmitter {
    private listeners: Record<string, Listener[]> = {};

    on(event: string, callback: Listener): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event: string, callback: Listener): void {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event: string, data?: any): void {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }
}

export interface PeerData {
    head: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
    };
    hands: {
        left: any; // Refine with actual hand data structure if needed
        right: any;
    };
}

export interface StrokeData {
    points: { x: number, y: number, z: number }[];
    color: number;
    size: number;
}

export class NetworkManager extends SimpleEventEmitter {
    public peers: Map<string, PeerData>;
    public localId: string;
    public latency: number;

    constructor() {
        super();
        this.peers = new Map();
        this.localId = Math.random().toString(36).substr(2, 9);
        this.latency = 50;

        console.log(`[Network] Initialized as user ${this.localId}`);

        // Mock connecting to a server
        setTimeout(() => {
            this.emit('connected', this.localId);
            this.mockPeerConnection();
        }, 500);
    }

    private mockPeerConnection(): void {
        // Simulate a second user joining after 2 seconds
        setTimeout(() => {
            const peerId = 'peer_' + Math.random().toString(36).substr(2, 9);
            const mockPeer: PeerData = {
                head: { position: { x: 0, y: 1.6, z: 2 }, rotation: { x: 0, y: 0, z: 0 } },
                hands: { left: null, right: null }
            };
            this.peers.set(peerId, mockPeer);
            this.emit('peer-joined', peerId);
            console.log(`[Network] Peer ${peerId} joined`);

            // Simulate peer activity
            setInterval(() => {
                this.updateMockPeer(peerId);
            }, 1000 / 30);
        }, 2000);
    }

    private updateMockPeer(peerId: string): void {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        // Move peer head slightly
        const time = Date.now() / 1000;
        peer.head.position.x = Math.sin(time) * 0.5;
        peer.head.position.z = 2 + Math.cos(time) * 0.2;

        this.emit('peer-update', { id: peerId, data: peer });
    }

    public broadcast(type: string, data: any): void {
        // In a real app, this would send data to the server
        // console.log(`[Network] Broadcasting ${type}`, data);
    }

    public sendObjectCreate(objectData: any): void {
        this.broadcast('object-create', objectData);
    }

    public sendObjectUpdate(objectId: string, transform: any): void {
        this.broadcast('object-update', { id: objectId, transform });
    }

    public sendStroke(data: StrokeData): void {
        this.broadcast('stroke', data);

        // For local testing, we don't need to do anything else as we see our own stroke.
        // But to prove networking works, let's make the "mock peer" draw something back 
        // a few seconds after we draw.
        // this.mockPeerResponse();
    }

    private mockPeerResponse(): void {
        setTimeout(() => {
            // Create a simple spiral stroke
            const points = [];
            for (let i = 0; i < 20; i++) {
                const t = i / 10;
                points.push({
                    x: Math.sin(t * Math.PI) * 0.2 + 0.5, // Offset to the right
                    y: 1.5 + t * 0.1,
                    z: Math.cos(t * Math.PI) * 0.2 - 0.5
                });
            }

            const mockStroke: StrokeData = {
                points: points,
                color: 0xff00ff, // Magenta for peer
                size: 0.015
            };

            this.emit('stroke-received', mockStroke);
            console.log('[Network] Received mock stroke from peer');
        }, 2000);
    }
}
