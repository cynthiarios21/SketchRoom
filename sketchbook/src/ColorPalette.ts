import * as THREE from 'three';

export class ColorPalette {
    private baseSlots: number[] = [
        0xFF0000, // Red
        0xFF8800, // Orange
        0xFFFF00, // Yellow
        0x00FF00, // Green
        0x0088FF, // Blue
        0x8800FF  // Purple
    ];
    private slots: number[] = [...this.baseSlots];
    private activeSlotIndex: number = 0;
    private lastTapTime: number = 0;
    private lastTappedSlot: number = -1;
    private readonly DOUBLE_TAP_THRESHOLD = 500; // ms

    public getSlots(): number[] {
        return [...this.slots];
    }

    public getBaseColor(index: number): number {
        return this.baseSlots[index];
    }

    public getActiveColor(): number {
        return this.slots[this.activeSlotIndex];
    }

    public getActiveSlotIndex(): number {
        return this.activeSlotIndex;
    }

    public selectSlot(index: number): 'single' | 'double' {
        const now = Date.now();
        const isDoubleTap =
            index === this.lastTappedSlot &&
            (now - this.lastTapTime) < this.DOUBLE_TAP_THRESHOLD;

        this.lastTappedSlot = index;
        this.lastTapTime = now;

        if (isDoubleTap) {
            return 'double';
        } else {
            this.activeSlotIndex = index;
            return 'single';
        }
    }

    public customizeSlot(index: number, color: number): void {
        if (index >= 0 && index < this.slots.length) {
            this.slots[index] = color;
        }
    }

    // Convert HSV to RGB (for color picker)
    public static hsvToRgb(h: number, s: number, v: number): number {
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;

        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }

        const rInt = Math.round((r + m) * 255);
        const gInt = Math.round((g + m) * 255);
        const bInt = Math.round((b + m) * 255);

        return (rInt << 16) | (gInt << 8) | bInt;
    }

    // Convert RGB to HSV (for displaying current color in picker)
    public static rgbToHsv(color: number): { h: number, s: number, v: number } {
        const r = ((color >> 16) & 0xFF) / 255;
        const g = ((color >> 8) & 0xFF) / 255;
        const b = (color & 0xFF) / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;

        let h = 0;
        if (delta !== 0) {
            if (max === r) h = 60 * (((g - b) / delta) % 6);
            else if (max === g) h = 60 * (((b - r) / delta) + 2);
            else h = 60 * (((r - g) / delta) + 4);
        }
        if (h < 0) h += 360;

        const s = max === 0 ? 0 : delta / max;
        const v = max;

        return { h, s, v };
    }
    public getShades(color: number): number[] {
        const { h, s, v } = ColorPalette.rgbToHsv(color);
        const shades: number[] = [];

        // 1. Very Light (Tint)
        shades.push(ColorPalette.hsvToRgb(h, Math.max(0, s - 0.6), Math.min(1, v + 0.2)));
        // 2. Light
        shades.push(ColorPalette.hsvToRgb(h, Math.max(0, s - 0.3), v));
        // 3. Base (Pure) - Reset to full saturation/value if it was dull, or keep as is? 
        // Let's just keep the hue and maximize S/V for the "pure" version
        shades.push(ColorPalette.hsvToRgb(h, 1, 1));
        // 4. Dark (Shade)
        shades.push(ColorPalette.hsvToRgb(h, 1, Math.max(0, v - 0.3)));
        // 5. Very Dark
        shades.push(ColorPalette.hsvToRgb(h, 1, Math.max(0, v - 0.6)));

        return shades;
    }
}
