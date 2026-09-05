import { ActionEvent, MotionFrame } from '../motion/Types';

export interface P2PPacket {
  type: 'motion' | 'action' | 'score' | 'ping' | 'ready';
  sender: 'host' | 'guest';
  timestamp: number;
  data: any;
}

export class P2PManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isHost = false;
  private roomCode = '';
  private isConnected = false;

  private packetListeners: ((packet: P2PPacket) => void)[] = [];

  constructor() {
    this.roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public onPacket(cb: (packet: P2PPacket) => void): () => void {
    this.packetListeners.push(cb);
    return () => {
      this.packetListeners = this.packetListeners.filter(l => l !== cb);
    };
  }

  public send(packet: P2PPacket): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(packet));
    }
  }

  public sendAction(event: ActionEvent): void {
    this.send({
      type: 'action',
      sender: this.isHost ? 'host' : 'guest',
      timestamp: Date.now(),
      data: event
    });
  }

  public sendMotion(frame: MotionFrame): void {
    // Send lightweight motion subset
    this.send({
      type: 'motion',
      sender: this.isHost ? 'host' : 'guest',
      timestamp: Date.now(),
      data: {
        action: frame.activeAction,
        dominantArm: frame.metrics.dominantArm,
        rightWristVel: frame.metrics.rightWristVelocity,
        leftWristVel: frame.metrics.leftWristVelocity,
        hipCenter: frame.metrics.hipCenterWorld,
        torsoYaw: frame.metrics.torsoYawDeg
      }
    });
  }

  public destroy(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.isConnected = false;
  }
}
