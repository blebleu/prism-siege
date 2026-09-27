// The warping background grid: a mesh of points on springs. Explosions push points outward, and neighbouring
// points pull on each other, so ripples spread across the arena and settle back.
const STIFFNESS = 28;   // pull back to each point's rest position
const COUPLING = 55;    // pull toward neighbours' displacement, which carries ripples along
const DAMPING = 4.5;
const STEP = 1 / 60;

export function createGrid(width, height, spacing) {
  const cols = Math.round(width / spacing) + 1, rows = Math.round(height / spacing) + 1;
  const count = cols * rows;
  const grid = { cols, rows, spacing, restX: new Float32Array(count), restY: new Float32Array(count), dx: new Float32Array(count), dy: new Float32Array(count), vx: new Float32Array(count), vy: new Float32Array(count), carry: 0 };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      grid.restX[i] = (col / (cols - 1)) * width;
      grid.restY[i] = (row / (rows - 1)) * height;
    }
  }
  return grid;
}

// Pushes points within `radius` of (x, y) outward (a negative strength pulls them in).
export function pushGrid(grid, x, y, radius, strength) {
  const { cols, rows, spacing, restX, restY, vx, vy } = grid;
  const c0 = Math.max(1, Math.floor((x - radius) / spacing)), c1 = Math.min(cols - 2, Math.ceil((x + radius) / spacing));
  const r0 = Math.max(1, Math.floor((y - radius) / spacing)), r1 = Math.min(rows - 2, Math.ceil((y + radius) / spacing));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = row * cols + col;
      const ox = restX[i] + grid.dx[i] - x, oy = restY[i] + grid.dy[i] - y;
      const d = Math.hypot(ox, oy);
      if (d >= radius || d < 0.001) continue;
      const force = strength * (1 - d / radius);
      vx[i] += (ox / d) * force;
      vy[i] += (oy / d) * force;
    }
  }
}

export function updateGrid(grid, dt) {
  grid.carry = Math.min(grid.carry + dt, STEP * 4);
  const { cols, rows, dx, dy, vx, vy } = grid;
  while (grid.carry >= STEP) {
    grid.carry -= STEP;
    // The border stays pinned; interior points spring toward rest and toward their neighbours.
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        const nx = dx[i - 1] + dx[i + 1] + dx[i - cols] + dx[i + cols] - 4 * dx[i];
        const ny = dy[i - 1] + dy[i + 1] + dy[i - cols] + dy[i + cols] - 4 * dy[i];
        vx[i] += (-STIFFNESS * dx[i] + COUPLING * nx - DAMPING * vx[i]) * STEP;
        vy[i] += (-STIFFNESS * dy[i] + COUPLING * ny - DAMPING * vy[i]) * STEP;
      }
    }
    for (let i = 0; i < dx.length; i++) {
      dx[i] += vx[i] * STEP;
      dy[i] += vy[i] * STEP;
    }
  }
}

export function drawGrid(ctx, grid, color, majorColor) {
  const { cols, rows, restX, restY, dx, dy } = grid;
  const line = (major, points) => {
    ctx.strokeStyle = major ? majorColor : color;
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.beginPath();
    points(ctx);
    ctx.stroke();
  };
  for (let row = 0; row < rows; row++) {
    line(row % 4 === 0, c => {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        col ? c.lineTo(restX[i] + dx[i], restY[i] + dy[i]) : c.moveTo(restX[i] + dx[i], restY[i] + dy[i]);
      }
    });
  }
  for (let col = 0; col < cols; col++) {
    line(col % 4 === 0, c => {
      for (let row = 0; row < rows; row++) {
        const i = row * cols + col;
        row ? c.lineTo(restX[i] + dx[i], restY[i] + dy[i]) : c.moveTo(restX[i] + dx[i], restY[i] + dy[i]);
      }
    });
  }
}
