import { spawn } from "child_process";

class MAX7219Matrix {
  constructor(numChips = 4) {
    this.numChips = numChips;
    this.state = Array(numChips)
      .fill(0)
      .map(() => Array(8).fill(0));

    // Persistent Python process as SPI bridge
    this.py = spawn("python3", [
      "-u",
      "-c",
      `
import sys, spidev, json
spi = spidev.SpiDev()
spi.open(0, 0)
spi.max_speed_hz = 500000
for line in sys.stdin:
    spi.xfer2(json.loads(line))
    print("ok", flush=True)
    `,
    ]);

    this.py.stderr.on("data", (d) => console.error("py:", d.toString()));
  }

  send(bytes) {
    return new Promise((resolve) => {
      this.py.stdout.once("data", () => resolve());
      this.py.stdin.write(JSON.stringify(bytes) + "\n");
    });
  }

  writeAll(register, values) {
    const bytes = [];
    for (let i = this.numChips - 1; i >= 0; i--) {
      bytes.push(register, values[i]);
    }
    return this.send(bytes);
  }

  writeAllSame(register, value) {
    return this.writeAll(register, Array(this.numChips).fill(value));
  }

  async init() {
    await this.writeAllSame(0x0f, 0x00); // display test off
    await this.writeAllSame(0x09, 0x00); // no decode
    await this.writeAllSame(0x0b, 0x07); // scan all 8 rows
    await this.writeAllSame(0x0a, 0x02); // moderate intensity
    await this.writeAllSame(0x0c, 0x01); // power on
    await this.clear();
  }

  async setPixel(x, y, on) {
    const chip = Math.floor(x / 8);
    const row = 7 - y;
    const bit = x % 8;
    if (on) this.state[chip][row] |= 1 << bit;
    else this.state[chip][row] &= ~(1 << bit);
    await this.updateRow(row);
  }

  getPixels() {
    const width = this.numChips * 8;
    return Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        const chip = Math.floor(x / 8);
        const row = 7 - y;
        const bit = x % 8;
        return (this.state[chip][row] >> bit) & 1;
      }).reverse(),
    ).reverse();
  }

  async setPixels(pixels) {
    const width = this.numChips * 8;
    this.state = this.state.map(() => Array(8).fill(0));

    for (let y = 0; y < 8; y++) {
      const rowIn = pixels[y];
      if (!rowIn) continue;
      for (let x = 0; x < width; x++) {
        if (!rowIn[x]) continue;
        const flippedX = width - 1 - x;
        this.state[Math.floor(flippedX / 8)][y] |= 1 << (flippedX % 8);
      }
    }

    await this.flush();
  }

  async flush() {
    for (let row = 0; row < 8; row++) await this.updateRow(row);
  }

  updateRow(row) {
    return this.writeAll(
      row + 1,
      this.state.map((c) => c[row]),
    );
  }

  async clear() {
    this.state = this.state.map(() => Array(8).fill(0));
    for (let row = 0; row < 8; row++) await this.updateRow(row);
  }
}

export { MAX7219Matrix };
