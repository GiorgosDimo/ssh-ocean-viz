import '@testing-library/jest-dom';

// ── Canvas / WebGL stubs ────────────────────────────────────────────────────
// jsdom has no canvas implementation; provide minimal stubs so WebGL-path
// tests can spy on GL calls without needing a GPU.

export const mockGl = {
  // Constants (values match the WebGL spec)
  TEXTURE0:        0x84C0,
  TEXTURE1:        0x84C1,
  TEXTURE_2D:      0x0DE1,
  RGBA:            0x1908,
  UNSIGNED_BYTE:   0x1401,
  LINEAR:          0x2601,
  CLAMP_TO_EDGE:   0x812F,
  TRIANGLE_STRIP:  0x0005,
  VERTEX_SHADER:   0x8B31,
  FRAGMENT_SHADER: 0x8B30,
  STATIC_DRAW:     0x88B4,
  ARRAY_BUFFER:    0x8892,
  FLOAT:           0x1406,
  // Methods
  activeTexture:          jest.fn(),
  bindTexture:            jest.fn(),
  texImage2D:             jest.fn(),
  texParameteri:          jest.fn(),
  drawArrays:             jest.fn(),
  flush:                  jest.fn(),
  createTexture:          jest.fn(() => ({})),
  createBuffer:           jest.fn(() => ({})),
  createShader:           jest.fn(() => ({})),
  createProgram:          jest.fn(() => ({})),
  attachShader:           jest.fn(),
  shaderSource:           jest.fn(),
  compileShader:          jest.fn(),
  linkProgram:            jest.fn(),
  useProgram:             jest.fn(),
  bindBuffer:             jest.fn(),
  bufferData:             jest.fn(),
  enableVertexAttribArray:jest.fn(),
  vertexAttribPointer:    jest.fn(),
  getAttribLocation:      jest.fn(() => 0),
  getUniformLocation:     jest.fn(() => ({})),
  uniform1i:              jest.fn(),
  uniform1f:              jest.fn(),
  getExtension:           jest.fn(() => null),
  viewport:               jest.fn(),
};

export const mockCtx2d = {
  drawImage:    jest.fn(),
  getImageData: jest.fn((x: number, y: number, w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
  })),
  putImageData:  jest.fn(),
  clearRect:     jest.fn(),
};

// Patch prototype once so every canvas element in every test gets the stubs.
HTMLCanvasElement.prototype.getContext = function (
  type: string,
): RenderingContext | null {
  if (type === 'webgl') return mockGl as unknown as WebGLRenderingContext;
  if (type === '2d')    return mockCtx2d as unknown as CanvasRenderingContext2D;
  return null;
};

// Restore spied functions and reset all mock state before each test.
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
